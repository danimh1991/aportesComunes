import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpDown, BarChart3, CalendarDays, Check, ChevronDown, ChevronRight, CirclePlus, Download, FileSpreadsheet, KeyRound, Landmark, Pencil, PiggyBank, Plus, Settings2, Trash2, Upload, UserRound, X } from "lucide-react";
import { NavigationEntry, useAppHistory } from "./useAppHistory";

declare global {
  interface Document {
    modelContext?: {
      registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): void | Promise<void>;
    };
  }
}

type Person = {
  id: number;
  name: string;
  total?: number;
  income?: number;
  share?: number;
};
type Destination = {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  total?: number;
};
type Rule = {
  id: number;
  year: number;
  destination_id: number;
  destination_name: string;
  rate_bps: number;
  date_from: string;
  date_to: string;
  person_id: number | null;
  person_name: string | null;
};
type Entry = {
  id: number;
  year: number;
  income_date: string;
  concept: string;
  person_id: number;
  person_name: string;
  amount: number;
  allocations: Record<string, number>;
  contribution: number;
};
type Bootstrap = {
  year: number;
  years: number[];
  people: Person[];
  destinations: Destination[];
  rules: Rule[];
  entries: Entry[];
  summary: { total: number; destinations: Destination[]; people: Person[] };
};
type IncomeForm = {
  date: string;
  concept: string;
  personId: string;
  amount: string;
};
type ImportedIncome = {
  date: string;
  concept: string;
  personId: number;
  amount: number;
};
type AuthState = "checking" | "locked" | "authenticated";
type NavigationTarget = {
  [View in NavigationEntry["view"]]: Omit<Extract<NavigationEntry, { view: View }>, "year">;
}[NavigationEntry["view"]];

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});
const percent = new Intl.NumberFormat("es-ES", {
  style: "percent",
  maximumFractionDigits: 1,
});
const day = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
});
const month = new Intl.DateTimeFormat("es-ES", { month: "short" });
const destinationColors = ["#20b99a", "#4a7ef0", "#f1a24d", "#a16ae8", "#eb6ca4", "#6c8da5"];
const apiRoot = () => (window.location.pathname.startsWith("/aportescomunes") ? "/aportescomunes/api" : "/api");
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

function parseCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function csvAmount(value: string) {
  const clean = value.replace(/[€\s\u00a0]/g, "");
  if (clean.includes(",") && clean.includes(".")) {
    return Number(clean.lastIndexOf(",") > clean.lastIndexOf(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, ""));
  }
  return Number(clean.replace(",", "."));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(payload.error ?? "No se pudo completar la operación.", response.status);
  return payload;
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const { stack: navigationStack, push: pushNavigation, close: closeNavigation, clearCurrentEntry } = useAppHistory();
  const [importRows, setImportRows] = useState<ImportedIncome[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear() + 1));
  const [destinationForm, setDestinationForm] = useState({
    name: "",
    color: destinationColors[0],
  });
  const formRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<IncomeForm>({
    date: today(),
    concept: "",
    personId: "1",
    amount: "",
  });
  const [ruleForm, setRuleForm] = useState({
    destinationId: "1",
    percentage: "",
    dateFrom: `${selectedYear}-01-01`,
    dateTo: `${selectedYear}-12-31`,
    personId: "",
  });
  const topNavigation = navigationStack.at(-1);
  const findNavigation = <T extends NavigationEntry["view"]>(view: T) => [...navigationStack].reverse().find((entry) => entry.view === view) as Extract<NavigationEntry, { view: T }> | undefined;
  const rulesOpen = navigationStack.some((entry) => entry.view === "rules");
  const yearOpen = Boolean(findNavigation("year-new"));
  const destinationOpen = Boolean(findNavigation("destination-new"));
  const dataOpen = Boolean(findNavigation("data"));
  const selectedDestinationId = findNavigation("destination-detail")?.id ?? null;
  const editingId = findNavigation("income-edit")?.id ?? null;
  const editingRuleId = findNavigation("rule-edit")?.id ?? null;

  const openNavigation = (entry: NavigationTarget) => pushNavigation({ ...entry, year: selectedYear } as NavigationEntry);
  const previousEditingId = useRef<number | null>(null);
  const previousEditingRuleId = useRef<number | null>(null);

  const load = useCallback(
    async (year = selectedYear) => {
      setLoading(true);
      setError("");
      try {
        const result = await api<Bootstrap>(`/bootstrap?year=${year}`);
        setData(result);
        if (result.people.length && !result.people.some((person) => String(person.id) === form.personId)) {
          setForm((current) => ({
            ...current,
            personId: String(result.people[0].id),
          }));
        }
      } catch (problem) {
        if (problem instanceof ApiError && problem.status === 401) {
          setAuthState("locked");
          setData(null);
          return;
        }
        setError(problem instanceof Error ? problem.message : "No se pudieron cargar los datos.");
      } finally {
        setLoading(false);
      }
    },
    [selectedYear, form.personId],
  );

  useEffect(() => {
    let active = true;
    void api<{ ok: boolean }>("/session")
      .then(() => {
        if (active) setAuthState("authenticated");
      })
      .catch(() => {
        if (active) setAuthState("locked");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (authState === "authenticated") void load(selectedYear);
  }, [selectedYear, authState]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRuleForm((current) => ({
      ...current,
      dateFrom: `${selectedYear}-01-01`,
      dateTo: `${selectedYear}-12-31`,
    }));
  }, [selectedYear]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (topNavigation && topNavigation.year !== selectedYear) setSelectedYear(topNavigation.year);
  }, [topNavigation]); // A restored Back/Forward entry owns the year it was opened from.
  useEffect(() => {
    if (authState === "locked" && navigationStack.length) clearCurrentEntry();
  }, [authState, navigationStack.length, clearCurrentEntry]);
  useEffect(() => {
    if (editingId !== null) {
      const entry = data?.entries.find((item) => item.id === editingId);
      if (entry && previousEditingId.current !== editingId) {
        setForm({
          date: entry.income_date,
          concept: entry.concept,
          personId: String(entry.person_id),
          amount: String(entry.amount).replace(".", ","),
        });
        window.requestAnimationFrame(() =>
          formRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
      }
    } else if (previousEditingId.current !== null) {
      setForm({
        date: `${selectedYear}-${today().slice(5)}`,
        concept: "",
        personId: String(data?.people[0]?.id ?? 1),
        amount: "",
      });
    }
    if (editingId === null || data?.entries.some((item) => item.id === editingId)) previousEditingId.current = editingId;
  }, [editingId, data, selectedYear]);
  useEffect(() => {
    if (editingRuleId !== null) {
      const rule = data?.rules.find((item) => item.id === editingRuleId);
      if (rule && previousEditingRuleId.current !== editingRuleId) {
        setRuleForm({
          destinationId: String(rule.destination_id),
          percentage: String(rule.rate_bps / 100).replace(".", ","),
          dateFrom: rule.date_from,
          dateTo: rule.date_to,
          personId: rule.person_id ? String(rule.person_id) : "",
        });
      }
    } else if (previousEditingRuleId.current !== null) {
      setRuleForm({
        destinationId: String(data?.destinations[0]?.id ?? 1),
        percentage: "",
        dateFrom: `${selectedYear}-01-01`,
        dateTo: `${selectedYear}-12-31`,
        personId: "",
      });
    }
    if (editingRuleId === null || data?.rules.some((item) => item.id === editingRuleId)) previousEditingRuleId.current = editingRuleId;
  }, [editingRuleId, data, selectedYear]);

  const numericAmount = Number(form.amount.replace(",", ".")) || 0;
  const allocations = useMemo(() => {
    if (!data) return [];
    return data.destinations
      .map((destination) => {
        const rateBps = data.rules.filter((rule) => rule.destination_id === destination.id && rule.date_from <= form.date && rule.date_to >= form.date && (!rule.person_id || String(rule.person_id) === form.personId)).reduce((sum, rule) => sum + rule.rate_bps, 0);
        return {
          ...destination,
          rateBps,
          value: (numericAmount * rateBps) / 10000,
        };
      })
      .filter((item) => item.rateBps > 0);
  }, [data, form.date, form.personId, numericAmount]);
  const previewTotal = allocations.reduce((sum, item) => sum + item.value, 0);
  const activeDestinations = useMemo(() => data?.summary.destinations.filter((destination) => (destination.total ?? 0) > 0 || data.rules.some((rule) => rule.destination_id === destination.id)) ?? [], [data]);
  const destinationDetail = useMemo(() => {
    if (!data || selectedDestinationId === null) return null;
    const destination = data.summary.destinations.find((item) => item.id === selectedDestinationId);
    if (!destination) return null;
    const entries = data.entries.filter((entry) => (entry.allocations[String(destination.id)] ?? 0) > 0);
    const people = data.people
      .map((person) => {
        const total = entries.filter((entry) => entry.person_id === person.id).reduce((sum, entry) => sum + (entry.allocations[String(destination.id)] ?? 0), 0);
        return {
          ...person,
          total,
          share: (destination.total ?? 0) ? total / (destination.total ?? 0) : 0,
        };
      })
      .filter((person) => (person.total ?? 0) > 0);
    const months = Array.from({ length: 12 }, (_, index) => {
      const key = `${selectedYear}-${String(index + 1).padStart(2, "0")}`;
      return {
        key,
        label: month.format(new Date(selectedYear, index, 1)).replace(".", ""),
        total: entries.filter((entry) => entry.income_date.startsWith(key)).reduce((sum, entry) => sum + (entry.allocations[String(destination.id)] ?? 0), 0),
      };
    });
    const rules = data.rules.filter((rule) => rule.destination_id === destination.id);
    return {
      destination,
      entries,
      people,
      months,
      rules,
      maxMonth: Math.max(...months.map((item) => item.total), 0),
    };
  }, [data, selectedDestinationId, selectedYear]);

  const resetForm = () => {
    setForm({
      date: `${selectedYear}-${today().slice(5)}`,
      concept: "",
      personId: String(data?.people[0]?.id ?? 1),
      amount: "",
    });
    if (editingId !== null) closeNavigation("income-edit");
  };

  const saveIncome = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        date: form.date,
        concept: form.concept,
        personId: Number(form.personId),
        amount: numericAmount,
      };
      await api(editingId ? `/incomes/${editingId}` : "/incomes", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setToast(editingId ? "Movimiento actualizado" : "Ingreso guardado");
      if (editingId !== null) closeNavigation("income-edit");
      else resetForm();
      const targetYear = Number(form.date.slice(0, 4));
      if (targetYear !== selectedYear) setSelectedYear(targetYear);
      else await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo guardar el ingreso.");
    } finally {
      setSaving(false);
    }
  };

  const editIncome = (entry: Entry) => {
    openNavigation({ view: "income-edit", id: entry.id });
  };

  const deleteIncome = async (entry: Entry) => {
    if (!window.confirm(`¿Eliminar “${entry.concept}” de ${entry.person_name}?`)) return;
    try {
      await api(`/incomes/${entry.id}`, { method: "DELETE" });
      setToast("Movimiento eliminado");
      await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo eliminar.");
    }
  };

  const createYear = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ year: number }>("/years", {
        method: "POST",
        body: JSON.stringify({ year: Number(newYear) }),
      });
      closeNavigation("year-new");
      setSelectedYear(result.year);
      setToast(`Año ${result.year} creado`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo crear el año.");
    }
  };

  const saveRule = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        year: selectedYear,
        destinationId: Number(ruleForm.destinationId),
        percentage: Number(ruleForm.percentage.replace(",", ".")),
        dateFrom: ruleForm.dateFrom,
        dateTo: ruleForm.dateTo,
        personId: ruleForm.personId ? Number(ruleForm.personId) : null,
      };
      await api(editingRuleId ? `/rules/${editingRuleId}` : "/rules", {
        method: editingRuleId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setRuleForm((current) =>
        editingRuleId
          ? {
              destinationId: current.destinationId,
              percentage: "",
              dateFrom: `${selectedYear}-01-01`,
              dateTo: `${selectedYear}-12-31`,
              personId: "",
            }
          : { ...current, percentage: "" },
      );
      if (editingRuleId !== null) closeNavigation("rule-edit");
      setToast(editingRuleId ? "Regla actualizada y aportes recalculados" : "Regla añadida");
      await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo guardar la regla.");
    }
  };

  const editRule = (rule: Rule) => {
    openNavigation({ view: "rule-edit", id: rule.id });
  };

  const cancelRuleEdit = () => {
    closeNavigation("rule-edit");
  };

  const deleteRule = async (rule: Rule) => {
    if (!window.confirm(`¿Eliminar la regla de ${rule.destination_name}?`)) return;
    try {
      await api(`/rules/${rule.id}`, { method: "DELETE" });
      setToast("Regla eliminada");
      await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo eliminar la regla.");
    }
  };

  const createDestination = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api<{ id: number }>("/destinations", {
        method: "POST",
        body: JSON.stringify(destinationForm),
      });
      setRuleForm((current) => ({
        ...current,
        destinationId: String(result.id),
      }));
      setDestinationForm({
        name: "",
        color: destinationColors[(data?.destinations.length ?? 0) % destinationColors.length],
      });
      closeNavigation("destination-new");
      setToast("Destino creado");
      await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo crear el destino.");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = [["fecha", "concepto", "persona", "importe"].map(csvCell).join(";"), ...data.entries.map((entry) => [entry.income_date, entry.concept, entry.person_name, entry.amount.toFixed(2).replace(".", ",")].map(csvCell).join(";"))];
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${lines.join("\r\n")}`], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `aportes-${selectedYear}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast(`CSV de ${selectedYear} exportado`);
  };

  const readImportFile = async (file?: File) => {
    setImportRows([]);
    setImportError("");
    setImportFileName(file?.name ?? "");
    if (!file || !data) return;
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("El archivo no contiene movimientos.");
      const normalize = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase();
      const headers = rows[0].map(normalize);
      const columns = {
        date: headers.indexOf("fecha"),
        concept: headers.indexOf("concepto"),
        person: headers.indexOf("persona"),
        amount: headers.indexOf("importe"),
      };
      if (Object.values(columns).some((index) => index < 0)) throw new Error("Faltan las columnas fecha, concepto, persona o importe.");
      const people = new Map(data.people.map((person) => [normalize(person.name), person.id]));
      const parsed = rows.slice(1).map((cells, index) => {
        const date = cells[columns.date]?.trim() ?? "";
        const concept = cells[columns.concept]?.trim() ?? "";
        const personName = normalize(cells[columns.person] ?? "");
        const personId = people.get(personName);
        const amount = csvAmount(cells[columns.amount] ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== selectedYear) throw new Error(`La fecha de la fila ${index + 2} no pertenece a ${selectedYear}.`);
        if (!concept || concept.length > 120) throw new Error(`Revisa el concepto de la fila ${index + 2}.`);
        if (!personId) throw new Error(`La persona de la fila ${index + 2} no coincide con las personas de la aplicación.`);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Revisa el importe de la fila ${index + 2}.`);
        return { date, concept, personId, amount };
      });
      if (parsed.length > 500) throw new Error("Puedes importar un máximo de 500 movimientos cada vez.");
      setImportRows(parsed);
    } catch (problem) {
      setImportError(problem instanceof Error ? problem.message : "No se pudo leer el archivo.");
    }
  };

  const importCsv = async () => {
    setImporting(true);
    setImportError("");
    try {
      const result = await api<{ imported: number; skipped: number }>("/incomes/import", {
        method: "POST",
        body: JSON.stringify({ year: selectedYear, entries: importRows }),
      });
      closeNavigation("data");
      setImportRows([]);
      setImportFileName("");
      setToast(result.skipped ? `${result.imported} importados · ${result.skipped} duplicados omitidos` : `${result.imported} movimientos importados`);
      await load(selectedYear);
    } catch (problem) {
      setImportError(problem instanceof Error ? problem.message : "No se pudieron importar los movimientos.");
    } finally {
      setImporting(false);
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setPinSubmitting(true);
    setPinError("");
    try {
      await api<{ ok: boolean }>("/login", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      setPin("");
      setAuthState("authenticated");
    } catch (problem) {
      setPinError(problem instanceof Error ? problem.message : "No se pudo comprobar el PIN.");
    } finally {
      setPinSubmitting(false);
    }
  };

  useEffect(() => {
    if (authState !== "authenticated") return;
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: "read_contribution_summary",
          title: "Consultar resumen de aportes",
          description: "Consulta los totales y el reparto del año visible.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: async () => ({
            year: selectedYear,
            total: data?.summary.total ?? 0,
            people: data?.summary.people ?? [],
            destinations: activeDestinations,
          }),
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: "create_destination",
          title: "Crear destino",
          description: "Crea un nuevo destino para poder usarlo en reglas de reparto.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, maxLength: 60 },
              color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            },
            required: ["name", "color"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const item = input as { name: string; color: string };
            const result = await api<{ id: number }>("/destinations", {
              method: "POST",
              body: JSON.stringify(item),
            });
            await load(selectedYear);
            return { id: result.id, status: "creado" };
          },
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: "create_income",
          title: "Añadir ingreso",
          description: "Guarda un ingreso y actualiza el reparto visible según las reglas del año.",
          inputSchema: {
            type: "object",
            properties: {
              date: { type: "string", format: "date" },
              concept: { type: "string" },
              personId: { type: "integer" },
              amount: { type: "number", exclusiveMinimum: 0 },
            },
            required: ["date", "concept", "personId", "amount"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const item = input as {
              date: string;
              concept: string;
              personId: number;
              amount: number;
            };
            const result = await api<{ id: number }>("/incomes", {
              method: "POST",
              body: JSON.stringify(item),
            });
            await load(Number(item.date.slice(0, 4)));
            return { id: result.id, status: "guardado" };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [authState, data, selectedYear, activeDestinations, load]);

  if (authState !== "authenticated") {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="access-title">
          <div className="auth-mark">
            <Landmark size={28} />
          </div>
          <p className="eyebrow">Aportes comunes</p>
          <h1 id="access-title">Acceso familiar</h1>
          {authState === "checking" ? (
            <p className="auth-copy">Comprobando acceso…</p>
          ) : (
            <>
              <p className="auth-copy">Introduce el PIN de 4 dígitos para continuar.</p>
              <form className="pin-form" onSubmit={unlock}>
                <label htmlFor="access-pin">PIN</label>
                <div className="pin-input">
                  <KeyRound size={19} aria-hidden="true" />
                  <input
                    id="access-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required
                    autoFocus
                    value={pin}
                    onChange={(event) => {
                      setPin(event.target.value.replace(/\D/g, ""));
                      setPinError("");
                    }}
                    aria-invalid={Boolean(pinError)}
                    aria-describedby={pinError ? "pin-error" : undefined}
                    placeholder="••••"
                  />
                </div>
                {pinError && (
                  <p className="pin-error" id="pin-error" role="alert">
                    {pinError}
                  </p>
                )}
                <button className="primary-button" disabled={pinSubmitting || pin.length !== 4}>
                  {pinSubmitting ? "Comprobando…" : "Entrar"}
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Landmark size={21} />
          </div>
          <div>
            <strong>Aportes comunes</strong>
            <span>Reparto familiar</span>
          </div>
        </div>
        <div className="top-actions">
          <label className="year-select">
            <span className="sr-only">Año</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {data?.years.map((year) => (
                <option value={year} key={year}>
                  {year}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
          <button className="icon-button" aria-label="Crear año" onClick={() => openNavigation({ view: "year-new" })}>
            <Plus size={19} />
          </button>
          <button className="icon-button" aria-label="Configurar reglas" onClick={() => openNavigation({ view: "rules" })}>
            <Settings2 size={19} />
          </button>
        </div>
      </header>

      <main>
        <section className="page-heading">
          <div>
            <p className="eyebrow">Resumen anual</p>
            <h1>Todo lo aportado, de un vistazo.</h1>
          </div>
          <button className="secondary-button" onClick={() => openNavigation({ view: "year-new" })}>
            <CalendarDays size={17} /> Añadir año
          </button>
        </section>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Cerrar">
              <X size={16} />
            </button>
          </div>
        )}
        {loading && !data ? (
          <div className="loading-card">Cargando aportes…</div>
        ) : (
          data && (
            <>
              <section className="summary-grid" aria-label="Resumen de aportes">
                <article className="summary-card dark total-card">
                  <p>Total aportado</p>
                  <strong>{euro.format(data.summary.total)}</strong>
                  <div className="summary-contributors">
                    {data.summary.people.length ? (
                      data.summary.people.map((person) => (
                        <span key={person.id}>
                          {percent.format(person.share ?? 0)} {person.name}
                          <small>{euro.format(person.total ?? 0)}</small>
                        </span>
                      ))
                    ) : (
                      <span>Sin movimientos</span>
                    )}
                  </div>
                </article>
              </section>

              <section className="workspace-grid">
                <article className="panel add-panel" ref={formRef}>
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">{editingId ? "Editar movimiento" : "Nuevo movimiento"}</p>
                      <h2>{editingId ? "Corrige este ingreso" : "Añadir lo que has ganado"}</h2>
                    </div>
                    <CirclePlus size={24} />
                  </div>
                  <form onSubmit={saveIncome}>
                    <div className="form-grid">
                      <label>
                        <span>Fecha</span>
                        <input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
                      </label>
                      <label>
                        <span>Quién</span>
                        <select value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}>
                          {data.people.map((person) => (
                            <option value={person.id} key={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide">
                        <span>Concepto</span>
                        <input required maxLength={120} placeholder="Ej. Nómina octubre" value={form.concept} onChange={(event) => setForm({ ...form, concept: event.target.value })} />
                      </label>
                      <label className="wide amount-field">
                        <span>Importe ganado</span>
                        <div>
                          <input required inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
                          <b>€</b>
                        </div>
                      </label>
                    </div>
                    <div className="distribution">
                      <div className="distribution-heading">
                        <span>Reparto calculado</span>
                        <strong>{euro.format(previewTotal)}</strong>
                      </div>
                      {allocations.length ? (
                        allocations.map((item) => (
                          <div className="allocation" key={item.id}>
                            <i style={{ background: item.color }} />
                            <span>
                              {item.name} <small>{(item.rateBps / 100).toLocaleString("es-ES")}%</small>
                            </span>
                            <strong>{euro.format(item.value)}</strong>
                          </div>
                        ))
                      ) : (
                        <p className="empty-inline">No hay reglas aplicables a esta fecha y persona.</p>
                      )}
                    </div>
                    <div className="form-actions">
                      {editingId && (
                        <button type="button" className="cancel-button" onClick={resetForm}>
                          Cancelar
                        </button>
                      )}
                      <button className="primary-button" disabled={saving}>
                        {saving ? "Guardando…" : editingId ? "Actualizar ingreso" : "Guardar ingreso"}
                      </button>
                    </div>
                  </form>
                </article>

                <article className="panel destinations-panel">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">Destinos</p>
                      <h2>Acumulado de {selectedYear}</h2>
                    </div>
                    <button className="panel-icon-button" onClick={() => openNavigation({ view: "destination-new" })} aria-label="Crear destino">
                      <Plus size={19} />
                    </button>
                  </div>
                  <div className="destination-list">
                    {activeDestinations.length ? (
                      activeDestinations.map((destination, index) => (
                        <button
                          type="button"
                          key={destination.id}
                          onClick={() =>
                            openNavigation({
                              view: "destination-detail",
                              id: destination.id,
                            })
                          }
                        >
                          <span className="destination-icon" style={{ background: destination.color }}>
                            {index === 0 ? <Landmark size={19} /> : index === 1 ? <PiggyBank size={19} /> : destination.name.slice(0, 1).toUpperCase()}
                          </span>
                          <p>
                            <b>{destination.name}</b>
                            <small>{data.rules.filter((rule) => rule.destination_id === destination.id).length} regla(s) · Ver detalle</small>
                          </p>
                          <strong>{euro.format(destination.total ?? 0)}</strong>
                          <ChevronRight size={17} aria-hidden="true" />
                        </button>
                      ))
                    ) : (
                      <p className="empty-state">Añade un destino y una regla para empezar el reparto.</p>
                    )}
                  </div>
                  <button className="text-button" onClick={() => openNavigation({ view: "rules" })}>
                    Ver y editar reglas
                  </button>
                </article>
              </section>

              <section className="panel movements-panel">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">Historial</p>
                    <h2>Movimientos de {selectedYear}</h2>
                  </div>
                  <div className="history-actions">
                    <span className="record-count">{data.entries.length} registros</span>
                    <button
                      className="data-button"
                      onClick={() => {
                        setImportRows([]);
                        setImportFileName("");
                        setImportError("");
                        openNavigation({ view: "data" });
                      }}
                    >
                      <ArrowUpDown size={14} /> Importar / exportar
                    </button>
                  </div>
                </div>
                {data.entries.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Concepto</th>
                          <th>Quién</th>
                          <th>Ganado</th>
                          {activeDestinations.map((destination) => (
                            <th key={destination.id}>{destination.name}</th>
                          ))}
                          <th>Total</th>
                          <th>
                            <span className="sr-only">Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td>{day.format(new Date(`${entry.income_date}T12:00:00`))}</td>
                            <td>{entry.concept}</td>
                            <td>
                              <span className={`person ${entry.person_name.toLowerCase()}`}>{entry.person_name}</span>
                            </td>
                            <td>{euro.format(entry.amount)}</td>
                            {activeDestinations.map((destination) => (
                              <td key={destination.id}>{euro.format(entry.allocations[String(destination.id)] ?? 0)}</td>
                            ))}
                            <td>
                              <strong>{euro.format(entry.contribution)}</strong>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button onClick={() => editIncome(entry)} aria-label={`Editar ${entry.concept}`}>
                                  <Pencil size={15} />
                                </button>
                                <button onClick={() => void deleteIncome(entry)} aria-label={`Eliminar ${entry.concept}`}>
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state large">
                    <CirclePlus size={24} />
                    <b>Todavía no hay movimientos</b>
                    <span>Añade el primer ingreso de {selectedYear}.</span>
                  </div>
                )}
              </section>
            </>
          )
        )}
      </main>

      {rulesOpen && !destinationOpen && data && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeNavigation(topNavigation?.view);
          }}
        >
          <section className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <button className="modal-close" onClick={() => closeNavigation(topNavigation?.view)} aria-label="Cerrar">
              <X size={19} />
            </button>
            <p className="eyebrow">Configuración de {selectedYear}</p>
            <h2 id="rules-title">{editingRuleId ? "Editar regla" : "Reglas de reparto"}</h2>
            <p className="modal-intro">{editingRuleId ? "Los movimientos ya guardados se recalcularán al guardar los cambios." : "Cada ingreso aplica las reglas activas en su fecha. Las reglas para una persona se suman a las de “Ambos”."}</p>
            <form className="rule-form" onSubmit={saveRule}>
              <label>
                <span>Destino</span>
                <div className="select-with-action">
                  <select
                    value={ruleForm.destinationId}
                    onChange={(event) =>
                      setRuleForm({
                        ...ruleForm,
                        destinationId: event.target.value,
                      })
                    }
                  >
                    {data.destinations.map((destination) => (
                      <option value={destination.id} key={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => openNavigation({ view: "destination-new" })} aria-label="Crear destino">
                    <Plus size={18} />
                  </button>
                </div>
              </label>
              <label>
                <span>Porcentaje</span>
                <div className="suffix-input">
                  <input
                    required
                    inputMode="decimal"
                    placeholder="7"
                    value={ruleForm.percentage}
                    onChange={(event) =>
                      setRuleForm({
                        ...ruleForm,
                        percentage: event.target.value,
                      })
                    }
                  />
                  <b>%</b>
                </div>
              </label>
              <label>
                <span>Desde</span>
                <input type="date" required value={ruleForm.dateFrom} onChange={(event) => setRuleForm({ ...ruleForm, dateFrom: event.target.value })} />
              </label>
              <label>
                <span>Hasta</span>
                <input type="date" required value={ruleForm.dateTo} onChange={(event) => setRuleForm({ ...ruleForm, dateTo: event.target.value })} />
              </label>
              <label className="wide">
                <span>Aplica a</span>
                <select value={ruleForm.personId} onChange={(event) => setRuleForm({ ...ruleForm, personId: event.target.value })}>
                  <option value="">Ambos</option>
                  {data.people.map((person) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rule-form-actions wide">
                {editingRuleId && (
                  <button type="button" className="cancel-button" onClick={cancelRuleEdit}>
                    Cancelar
                  </button>
                )}
                <button className="primary-button">
                  <Pencil size={16} /> {editingRuleId ? "Guardar cambios" : "Añadir regla"}
                </button>
              </div>
            </form>
            <div className="rules-list">
              {data.rules.map((rule) => (
                <div className={`rule-row ${editingRuleId === rule.id ? "editing" : ""}`} key={rule.id}>
                  <i
                    style={{
                      background: data.destinations.find((item) => item.id === rule.destination_id)?.color,
                    }}
                  />
                  <div>
                    <b>
                      {rule.destination_name} · {(rule.rate_bps / 100).toLocaleString("es-ES")}%
                    </b>
                    <span>
                      {rule.date_from.split("-").reverse().join("/")} – {rule.date_to.split("-").reverse().join("/")} · {rule.person_name ?? "Ambos"}
                    </span>
                  </div>
                  <div className="rule-actions">
                    <button onClick={() => editRule(rule)} aria-label={`Editar regla ${rule.destination_name}`}>
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => void deleteRule(rule)} aria-label={`Eliminar regla ${rule.destination_name}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {destinationOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeNavigation("destination-new");
          }}
        >
          <section className="modal destination-modal" role="dialog" aria-modal="true" aria-labelledby="destination-title">
            <button className="modal-close" onClick={() => closeNavigation("destination-new")} aria-label="Cerrar">
              <X size={19} />
            </button>
            <p className="eyebrow">Organiza el reparto</p>
            <h2 id="destination-title">Nuevo destino</h2>
            <p className="modal-intro">Ponle un nombre reconocible. Después podrás asignarle porcentajes desde las reglas.</p>
            <form onSubmit={createDestination}>
              <label>
                <span>Nombre</span>
                <input
                  autoFocus
                  required
                  maxLength={60}
                  placeholder="Ej. Vacaciones"
                  value={destinationForm.name}
                  onChange={(event) =>
                    setDestinationForm({
                      ...destinationForm,
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <fieldset>
                <legend>Color</legend>
                <div className="color-options">
                  {destinationColors.map((color) => (
                    <label key={color} style={{ background: color }}>
                      <input type="radio" name="destination-color" value={color} checked={destinationForm.color === color} onChange={() => setDestinationForm({ ...destinationForm, color })} />
                      <span className="sr-only">Color {color}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="primary-button" disabled={saving}>
                {saving ? "Creando…" : "Crear destino"}
              </button>
            </form>
          </section>
        </div>
      )}

      {destinationDetail && (
        <div
          className="modal-backdrop detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeNavigation("destination-detail");
          }}
        >
          <section className="modal destination-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <button className="detail-back" onClick={() => closeNavigation("destination-detail")}>
              <ArrowLeft size={18} /> Volver
            </button>
            <div className="detail-hero">
              <span className="destination-icon detail-icon" style={{ background: destinationDetail.destination.color }}>
                {destinationDetail.destination.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="eyebrow">Destino · {selectedYear}</p>
                <h2 id="detail-title">{destinationDetail.destination.name}</h2>
              </div>
              <strong>{euro.format(destinationDetail.destination.total ?? 0)}</strong>
            </div>
            <div className="detail-stats">
              <article>
                <BarChart3 size={18} />
                <span>Total anual</span>
                <strong>{euro.format(destinationDetail.destination.total ?? 0)}</strong>
              </article>
              <article>
                <UserRound size={18} />
                <span>Personas</span>
                <strong>{destinationDetail.people.length}</strong>
              </article>
              <article>
                <CalendarDays size={18} />
                <span>Movimientos</span>
                <strong>{destinationDetail.entries.length}</strong>
              </article>
            </div>
            <section className="detail-section">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Condiciones</p>
                  <h3>Reglas que afectan a este destino</h3>
                </div>
                <span className="record-count">
                  {destinationDetail.rules.length} {destinationDetail.rules.length === 1 ? "regla" : "reglas"}
                </span>
              </div>
              <div className="destination-rules">
                {destinationDetail.rules.length ? (
                  destinationDetail.rules.map((rule) => (
                    <article key={rule.id}>
                      <i
                        style={{
                          background: destinationDetail.destination.color,
                        }}
                      />
                      <div>
                        <b>
                          {(rule.rate_bps / 100).toLocaleString("es-ES")}% · {rule.person_name ?? "Ambos"}
                        </b>
                        <span>
                          Del {rule.date_from.split("-").reverse().join("/")} al {rule.date_to.split("-").reverse().join("/")}
                        </span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-state">Este destino no tiene reglas configuradas para {selectedYear}.</p>
                )}
              </div>
            </section>
            <section className="detail-section">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Evolución</p>
                  <h3>Resumen por mes</h3>
                </div>
              </div>
              <div className="month-chart">
                {destinationDetail.months.map((item) => (
                  <div className="month-column" key={item.key}>
                    <span title={item.total ? euro.format(item.total) : undefined}>{item.total ? euro.format(item.total) : ""}</span>
                    <div>
                      <i
                        style={{
                          height: `${destinationDetail.maxMonth ? Math.max(5, (item.total / destinationDetail.maxMonth) * 100) : 0}%`,
                          background: destinationDetail.destination.color,
                        }}
                      />
                    </div>
                    <b>{item.label}</b>
                  </div>
                ))}
              </div>
            </section>
            <section className="detail-section">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Participación</p>
                  <h3>Quién ha aportado</h3>
                </div>
              </div>
              <div className="people-breakdown">
                {destinationDetail.people.length ? (
                  destinationDetail.people.map((person) => (
                    <div key={person.id}>
                      <span className="person-avatar">{person.name.slice(0, 1)}</span>
                      <p>
                        <b>{person.name}</b>
                        <small>{percent.format(person.share ?? 0)} del destino</small>
                      </p>
                      <strong>{euro.format(person.total ?? 0)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="empty-state">Todavía no hay aportaciones.</p>
                )}
              </div>
            </section>
            <section className="detail-section">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Actividad</p>
                  <h3>Últimos movimientos</h3>
                </div>
                <span className="record-count">{destinationDetail.entries.length} registros</span>
              </div>
              <div className="detail-movements">
                {destinationDetail.entries.slice(0, 8).map((entry) => (
                  <div key={entry.id}>
                    <span>{day.format(new Date(`${entry.income_date}T12:00:00`))}</span>
                    <p>
                      <b>{entry.concept}</b>
                      <small>{entry.person_name}</small>
                    </p>
                    <strong>{euro.format(entry.allocations[String(destinationDetail.destination.id)] ?? 0)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </div>
      )}

      {dataOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeNavigation("data");
          }}
        >
          <section className="modal data-modal" role="dialog" aria-modal="true" aria-labelledby="data-title">
            <button className="modal-close" onClick={() => closeNavigation("data")} aria-label="Cerrar">
              <X size={19} />
            </button>
            <p className="eyebrow">Movimientos de {selectedYear}</p>
            <h2 id="data-title">Importar o exportar</h2>
            <p className="modal-intro">Usa un CSV sencillo para mover los ingresos. Las reglas y destinos no cambian.</p>
            <div className="data-options">
              <button className="data-option" onClick={exportCsv}>
                <span className="data-option-icon">
                  <Download size={19} />
                </span>
                <span>
                  <b>Exportar CSV</b>
                  <small>
                    Descarga {data?.entries.length ?? 0} movimientos de {selectedYear}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => void readImportFile(event.target.files?.[0])}
              />
              <button className="data-option" onClick={() => fileInputRef.current?.click()}>
                <span className="data-option-icon">
                  <Upload size={19} />
                </span>
                <span>
                  <b>Importar CSV</b>
                  <small>Columnas: fecha, concepto, persona e importe</small>
                </span>
                <ChevronRight size={17} />
              </button>
            </div>
            {importFileName && (
              <div className={`import-status ${importError ? "has-error" : ""}`}>
                <FileSpreadsheet size={20} />
                <div>
                  <b>{importFileName}</b>
                  {importError ? (
                    <span>{importError}</span>
                  ) : (
                    <span>
                      <Check size={14} /> {importRows.length} movimientos listos
                    </span>
                  )}
                </div>
                {!importError && (
                  <button className="import-button" disabled={importing || !importRows.length} onClick={() => void importCsv()}>
                    {importing ? "Importando…" : "Importar"}
                  </button>
                )}
              </div>
            )}
            <p className="data-note">Los movimientos ya existentes se omiten para evitar duplicados.</p>
          </section>
        </div>
      )}

      {yearOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeNavigation("year-new");
          }}
        >
          <section className="modal year-modal" role="dialog" aria-modal="true" aria-labelledby="year-title">
            <button className="modal-close" onClick={() => closeNavigation("year-new")} aria-label="Cerrar">
              <X size={19} />
            </button>
            <p className="eyebrow">Nuevo ejercicio</p>
            <h2 id="year-title">Crear un año</h2>
            <p className="modal-intro">El año se crea vacío. Después puedes definir sus reglas de reparto.</p>
            <form onSubmit={createYear}>
              <label>
                <span>Año</span>
                <input type="number" min="2000" max="2200" required value={newYear} onChange={(event) => setNewYear(event.target.value)} />
              </label>
              <button className="primary-button">Crear año</button>
            </form>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
