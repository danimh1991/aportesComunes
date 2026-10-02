interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  APP_PIN?: string;
}

type Person = { id: number; name: string };
type Destination = { id: number; name: string; color: string; sort_order: number };
type RuleRow = { id: number; year: number; destination_id: number; destination_name: string; rate_bps: number; date_from: string; date_to: string; person_id: number | null; person_name: string | null };
type IncomeRow = { id: number; year: number; income_date: string; concept: string; person_id: number; person_name: string; amount_cents: number };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => json({ error: message }, status);

function apiPath(pathname: string) {
  return pathname.startsWith("/aportescomunes/") ? pathname.slice("/aportescomunes".length) : pathname;
}

const sessionCookie = "aportes_session";
const configuredPin = (env: Env) => env.APP_PIN?.trim() || "0812";

function isAuthorized(request: Request, env: Env) {
  const expectedCookie = `${sessionCookie}=${encodeURIComponent(configuredPin(env))}`;
  return (request.headers.get("Cookie") ?? "").split(";").some((cookie) => cookie.trim() === expectedCookie);
}

function loginResponse(request: Request, env: Env) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Set-Cookie": `${sessionCookie}=${encodeURIComponent(configuredPin(env))}; Path=/; HttpOnly; SameSite=Strict${secure}`,
    },
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; }
  catch { throw new Error("Los datos enviados no son válidos."); }
}

function positiveInt(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} no es válido.`);
  return parsed;
}

function validDate(value: unknown, label: string) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} no es válida.`);
  return text;
}

function calculate(incomes: IncomeRow[], rules: RuleRow[], destinations: Destination[], people: Person[]) {
  const destinationTotals = Object.fromEntries(destinations.map((item) => [item.id, 0])) as Record<number, number>;
  const personTotals = Object.fromEntries(people.map((item) => [item.id, 0])) as Record<number, number>;
  const personIncomeTotals = Object.fromEntries(people.map((item) => [item.id, 0])) as Record<number, number>;
  let grandTotal = 0;

  const entries = incomes.map((income) => {
    const allocations = Object.fromEntries(destinations.map((item) => [item.id, 0])) as Record<number, number>;
    for (const rule of rules) {
      if (rule.date_from <= income.income_date && rule.date_to >= income.income_date && (!rule.person_id || rule.person_id === income.person_id)) {
        allocations[rule.destination_id] = (allocations[rule.destination_id] ?? 0) + (income.amount_cents * rule.rate_bps / 10000);
      }
    }
    const contributionCents = Object.values(allocations).reduce((sum, value) => sum + value, 0);
    for (const [destinationId, value] of Object.entries(allocations)) destinationTotals[Number(destinationId)] += value;
    personTotals[income.person_id] += contributionCents;
    personIncomeTotals[income.person_id] += income.amount_cents;
    grandTotal += contributionCents;
    return { ...income, amount: income.amount_cents / 100, allocations: Object.fromEntries(Object.entries(allocations).map(([key, value]) => [key, value / 100])), contribution: contributionCents / 100 };
  });

  return {
    entries,
    summary: {
      total: grandTotal / 100,
      destinations: destinations.map((item) => ({ ...item, total: destinationTotals[item.id] / 100 })),
      people: people.map((item) => ({ ...item, total: personTotals[item.id] / 100, income: personIncomeTotals[item.id] / 100, share: grandTotal ? personTotals[item.id] / grandTotal : 0 })),
    },
  };
}

async function bootstrap(env: Env, year: number) {
  const [yearsResult, peopleResult, destinationResult, ruleResult, incomeResult] = await env.DB.batch([
    env.DB.prepare("SELECT year FROM years ORDER BY year DESC"),
    env.DB.prepare("SELECT id, name FROM people ORDER BY id"),
    env.DB.prepare("SELECT id, name, color, sort_order FROM destinations ORDER BY sort_order, id"),
    env.DB.prepare(`SELECT r.id, r.year, r.destination_id, d.name AS destination_name, r.rate_bps, r.date_from, r.date_to, r.person_id, p.name AS person_name
      FROM rules r JOIN destinations d ON d.id = r.destination_id LEFT JOIN people p ON p.id = r.person_id WHERE r.year = ? ORDER BY r.date_from, d.sort_order`).bind(year),
    env.DB.prepare(`SELECT i.id, i.year, i.income_date, i.concept, i.person_id, p.name AS person_name, i.amount_cents
      FROM incomes i JOIN people p ON p.id = i.person_id WHERE i.year = ? ORDER BY i.income_date DESC, i.id DESC`).bind(year),
  ]);
  const years = (yearsResult.results as { year: number }[]).map((item) => item.year);
  const people = peopleResult.results as Person[];
  const destinations = destinationResult.results as Destination[];
  const rules = ruleResult.results as RuleRow[];
  const incomes = incomeResult.results as IncomeRow[];
  return { year, years, people, destinations, rules, ...calculate(incomes, rules, destinations, people) };
}

async function handleApi(request: Request, env: Env, path: string) {
  const url = new URL(request.url);
  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/bootstrap" && request.method === "GET") {
    const currentYear = new Date().getFullYear();
    const year = Number(url.searchParams.get("year")) || currentYear;
    return json(await bootstrap(env, year));
  }

  if (path === "/api/years" && request.method === "POST") {
    const body = await parseBody(request);
    const year = positiveInt(body.year, "El año");
    if (year < 2000 || year > 2200) return fail("El año debe estar entre 2000 y 2200.");
    await env.DB.prepare("INSERT INTO years (year) VALUES (?)").bind(year).run();
    return json({ year }, 201);
  }

  if (path === "/api/incomes" && request.method === "POST") {
    const body = await parseBody(request);
    const date = validDate(body.date, "La fecha");
    const concept = String(body.concept ?? "").trim();
    if (!concept || concept.length > 120) return fail("Escribe un concepto de hasta 120 caracteres.");
    const personId = positiveInt(body.personId, "La persona");
    const amountCents = Math.round(Number(body.amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return fail("El importe debe ser mayor que cero.");
    const year = Number(date.slice(0, 4));
    await env.DB.prepare("INSERT OR IGNORE INTO years (year) VALUES (?)").bind(year).run();
    const result = await env.DB.prepare("INSERT INTO incomes (year, income_date, concept, person_id, amount_cents) VALUES (?, ?, ?, ?, ?)").bind(year, date, concept, personId, amountCents).run();
    return json({ id: result.meta.last_row_id }, 201);
  }

  const incomeMatch = path.match(/^\/api\/incomes\/(\d+)$/);
  if (incomeMatch && request.method === "PUT") {
    const body = await parseBody(request);
    const id = Number(incomeMatch[1]);
    const date = validDate(body.date, "La fecha");
    const concept = String(body.concept ?? "").trim();
    const personId = positiveInt(body.personId, "La persona");
    const amountCents = Math.round(Number(body.amount) * 100);
    if (!concept || concept.length > 120 || amountCents <= 0) return fail("Revisa el concepto y el importe.");
    await env.DB.prepare("UPDATE incomes SET year = ?, income_date = ?, concept = ?, person_id = ?, amount_cents = ? WHERE id = ?").bind(Number(date.slice(0, 4)), date, concept, personId, amountCents, id).run();
    return json({ id });
  }
  if (incomeMatch && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM incomes WHERE id = ?").bind(Number(incomeMatch[1])).run();
    return json({ ok: true });
  }

  if (path === "/api/rules" && request.method === "POST") {
    const body = await parseBody(request);
    const year = positiveInt(body.year, "El año");
    const destinationId = positiveInt(body.destinationId, "El destino");
    const rateBps = Math.round(Number(body.percentage) * 100);
    const dateFrom = validDate(body.dateFrom, "La fecha inicial");
    const dateTo = validDate(body.dateTo, "La fecha final");
    const personId = body.personId ? positiveInt(body.personId, "La persona") : null;
    if (rateBps < 0 || rateBps > 10000 || dateFrom > dateTo) return fail("Revisa el porcentaje y las fechas.");
    const result = await env.DB.prepare("INSERT INTO rules (year, destination_id, rate_bps, date_from, date_to, person_id) VALUES (?, ?, ?, ?, ?, ?)").bind(year, destinationId, rateBps, dateFrom, dateTo, personId).run();
    return json({ id: result.meta.last_row_id }, 201);
  }

  const ruleMatch = path.match(/^\/api\/rules\/(\d+)$/);
  if (ruleMatch && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(Number(ruleMatch[1])).run();
    return json({ ok: true });
  }

  return fail("Ruta no encontrada.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = apiPath(url.pathname);
    try {
      if (path === "/api/login" && request.method === "POST") {
        const body = await parseBody(request);
        if (String(body.pin ?? "") !== configuredPin(env)) return fail("El PIN no es correcto.", 401);
        return loginResponse(request, env);
      }
      if (path.startsWith("/api/")) {
        if (!isAuthorized(request, env)) return fail("Introduce el PIN para continuar.", 401);
        if (path === "/api/session" && request.method === "GET") return json({ ok: true });
        return await handleApi(request, env, path);
      }
      if (url.pathname === "/aportescomunes") return Response.redirect(`${url.origin}/aportescomunes/`, 308);
      if (url.pathname.startsWith("/aportescomunes/")) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = url.pathname.slice("/aportescomunes".length) || "/";
        return env.ASSETS.fetch(new Request(assetUrl, request));
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
      if (message.includes("UNIQUE constraint failed")) return fail("Ese año ya existe.", 409);
      return fail(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;
