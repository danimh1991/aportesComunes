import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, CirclePlus, Landmark, Pencil, PiggyBank, Plus, Settings2, Trash2, WalletCards, X } from "lucide-react";

declare global {
  interface Document {
    modelContext?: {
      registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): void | Promise<void>;
    };
  }
}

type Person = { id: number; name: string; total?: number; income?: number; share?: number };
type Destination = { id: number; name: string; color: string; sort_order: number; total?: number };
type Rule = { id: number; year: number; destination_id: number; destination_name: string; rate_bps: number; date_from: string; date_to: string; person_id: number | null; person_name: string | null };
type Entry = { id: number; year: number; income_date: string; concept: string; person_id: number; person_name: string; amount: number; allocations: Record<string, number>; contribution: number };
type Bootstrap = { year: number; years: number[]; people: Person[]; destinations: Destination[]; rules: Rule[]; entries: Entry[]; summary: { total: number; destinations: Destination[]; people: Person[] } };
type IncomeForm = { date: string; concept: string; personId: string; amount: string };

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" });
const apiRoot = () => window.location.pathname.startsWith("/aportescomunes") ? "/aportescomunes/api" : "/api";
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot()}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "No se pudo completar la operación.");
  return payload;
}

export function App() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear() + 1));
  const [editingId, setEditingId] = useState<number | null>(null);
  const formRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState<IncomeForm>({ date: today(), concept: "", personId: "1", amount: "" });
  const [ruleForm, setRuleForm] = useState({ destinationId: "1", percentage: "", dateFrom: `${selectedYear}-01-01`, dateTo: `${selectedYear}-12-31`, personId: "" });

  const load = useCallback(async (year = selectedYear) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<Bootstrap>(`/bootstrap?year=${year}`);
      setData(result);
      if (result.people.length && !result.people.some((person) => String(person.id) === form.personId)) {
        setForm((current) => ({ ...current, personId: String(result.people[0].id) }));
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudieron cargar los datos.");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, form.personId]);

  useEffect(() => { void load(selectedYear); }, [selectedYear]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRuleForm((current) => ({ ...current, dateFrom: `${selectedYear}-01-01`, dateTo: `${selectedYear}-12-31` }));
  }, [selectedYear]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const numericAmount = Number(form.amount.replace(",", ".")) || 0;
  const allocations = useMemo(() => {
    if (!data) return [];
    return data.destinations.map((destination) => {
      const rateBps = data.rules
        .filter((rule) => rule.destination_id === destination.id && rule.date_from <= form.date && rule.date_to >= form.date && (!rule.person_id || String(rule.person_id) === form.personId))
        .reduce((sum, rule) => sum + rule.rate_bps, 0);
      return { ...destination, rateBps, value: numericAmount * rateBps / 10000 };
    }).filter((item) => item.rateBps > 0);
  }, [data, form.date, form.personId, numericAmount]);
  const previewTotal = allocations.reduce((sum, item) => sum + item.value, 0);
  const activeDestinations = useMemo(() => data?.summary.destinations.filter((destination) => (destination.total ?? 0) > 0 || data.rules.some((rule) => rule.destination_id === destination.id)) ?? [], [data]);

  const resetForm = () => {
    setForm({ date: `${selectedYear}-${today().slice(5)}`, concept: "", personId: String(data?.people[0]?.id ?? 1), amount: "" });
    setEditingId(null);
  };

  const saveIncome = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { date: form.date, concept: form.concept, personId: Number(form.personId), amount: numericAmount };
      await api(editingId ? `/incomes/${editingId}` : "/incomes", { method: editingId ? "PUT" : "POST", body: JSON.stringify(payload) });
      setToast(editingId ? "Movimiento actualizado" : "Ingreso guardado");
      resetForm();
      const targetYear = Number(form.date.slice(0, 4));
      if (targetYear !== selectedYear) setSelectedYear(targetYear); else await load(selectedYear);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se pudo guardar el ingreso.");
    } finally { setSaving(false); }
  };

  const editIncome = (entry: Entry) => {
    setEditingId(entry.id);
    setForm({ date: entry.income_date, concept: entry.concept, personId: String(entry.person_id), amount: String(entry.amount).replace(".", ",") });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteIncome = async (entry: Entry) => {
    if (!window.confirm(`¿Eliminar “${entry.concept}” de ${entry.person_name}?`)) return;
    try { await api(`/incomes/${entry.id}`, { method: "DELETE" }); setToast("Movimiento eliminado"); await load(selectedYear); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo eliminar."); }
  };

  const createYear = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ year: number }>("/years", { method: "POST", body: JSON.stringify({ year: Number(newYear) }) });
      setYearOpen(false); setSelectedYear(result.year); setToast(`Año ${result.year} creado`);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo crear el año."); }
  };

  const saveRule = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/rules", { method: "POST", body: JSON.stringify({ year: selectedYear, destinationId: Number(ruleForm.destinationId), percentage: Number(ruleForm.percentage.replace(",", ".")), dateFrom: ruleForm.dateFrom, dateTo: ruleForm.dateTo, personId: ruleForm.personId ? Number(ruleForm.personId) : null }) });
      setRuleForm((current) => ({ ...current, percentage: "" }));
      setToast("Regla añadida"); await load(selectedYear);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo guardar la regla."); }
  };

  const deleteRule = async (rule: Rule) => {
    if (!window.confirm(`¿Eliminar la regla de ${rule.destination_name}?`)) return;
    try { await api(`/rules/${rule.id}`, { method: "DELETE" }); setToast("Regla eliminada"); await load(selectedYear); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo eliminar la regla."); }
  };

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: "read_contribution_summary", title: "Consultar resumen de aportes", description: "Consulta los totales y el reparto del año visible.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async () => ({ year: selectedYear, total: data?.summary.total ?? 0, people: data?.summary.people ?? [], destinations: activeDestinations }),
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: "create_income", title: "Añadir ingreso", description: "Guarda un ingreso y actualiza el reparto visible según las reglas del año.",
        inputSchema: { type: "object", properties: { date: { type: "string", format: "date" }, concept: { type: "string" }, personId: { type: "integer" }, amount: { type: "number", exclusiveMinimum: 0 } }, required: ["date", "concept", "personId", "amount"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => { const item = input as { date: string; concept: string; personId: number; amount: number }; const result = await api<{ id: number }>("/incomes", { method: "POST", body: JSON.stringify(item) }); await load(Number(item.date.slice(0, 4))); return { id: result.id, status: "guardado" }; },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [data, selectedYear, activeDestinations, load]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Landmark size={21} /></div><div><strong>Aportes comunes</strong><span>Reparto familiar</span></div></div>
        <div className="top-actions">
          <label className="year-select"><span className="sr-only">Año</span><select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{data?.years.map((year) => <option value={year} key={year}>{year}</option>)}</select><ChevronDown size={16} /></label>
          <button className="icon-button" aria-label="Crear año" onClick={() => setYearOpen(true)}><Plus size={19} /></button>
          <button className="icon-button" aria-label="Configurar reglas" onClick={() => setRulesOpen(true)}><Settings2 size={19} /></button>
        </div>
      </header>

      <main>
        <section className="page-heading"><div><p className="eyebrow">Resumen anual</p><h1>Todo lo aportado, de un vistazo.</h1></div><button className="secondary-button" onClick={() => setYearOpen(true)}><CalendarDays size={17} /> Añadir año</button></section>
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Cerrar"><X size={16} /></button></div>}
        {loading && !data ? <div className="loading-card">Cargando aportes…</div> : data && <>
          <section className="summary-grid" aria-label="Resumen de aportes">
            <article className="summary-card dark"><p>Total aportado</p><strong>{euro.format(data.summary.total)}</strong><span>{data.summary.people.map((person) => `${percent.format(person.share ?? 0)} ${person.name}`).join(" · ") || "Sin movimientos"}</span></article>
            {data.summary.people.map((person, index) => <article className="summary-card" key={person.id}><p>{person.name}</p><strong>{euro.format(person.total ?? 0)}</strong><div className={`progress ${index % 2 ? "coral" : ""}`}><i style={{ width: `${(person.share ?? 0) * 100}%` }} /></div><span>{percent.format(person.share ?? 0)} del total · {euro.format(person.income ?? 0)} ganado</span></article>)}
          </section>

          <section className="workspace-grid">
            <article className="panel add-panel" ref={formRef}>
              <div className="panel-title"><div><p className="eyebrow">{editingId ? "Editar movimiento" : "Nuevo movimiento"}</p><h2>{editingId ? "Corrige este ingreso" : "Añadir lo que has ganado"}</h2></div><CirclePlus size={24} /></div>
              <form onSubmit={saveIncome}>
                <div className="form-grid">
                  <label><span>Fecha</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
                  <label><span>Quién</span><select value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}>{data.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                  <label className="wide"><span>Concepto</span><input required maxLength={120} placeholder="Ej. Nómina octubre" value={form.concept} onChange={(event) => setForm({ ...form, concept: event.target.value })} /></label>
                  <label className="wide amount-field"><span>Importe ganado</span><div><input required inputMode="decimal" placeholder="0,00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /><b>€</b></div></label>
                </div>
                <div className="distribution">
                  <div className="distribution-heading"><span>Reparto calculado</span><strong>{euro.format(previewTotal)}</strong></div>
                  {allocations.length ? allocations.map((item) => <div className="allocation" key={item.id}><i style={{ background: item.color }} /><span>{item.name} <small>{(item.rateBps / 100).toLocaleString("es-ES")}%</small></span><strong>{euro.format(item.value)}</strong></div>) : <p className="empty-inline">No hay reglas aplicables a esta fecha y persona.</p>}
                </div>
                <div className="form-actions">{editingId && <button type="button" className="cancel-button" onClick={resetForm}>Cancelar</button>}<button className="primary-button" disabled={saving}>{saving ? "Guardando…" : editingId ? "Actualizar ingreso" : "Guardar ingreso"}</button></div>
              </form>
            </article>

            <article className="panel destinations-panel">
              <div className="panel-title"><div><p className="eyebrow">Destinos</p><h2>Acumulado de {selectedYear}</h2></div><WalletCards size={23} /></div>
              <div className="destination-list">{activeDestinations.length ? activeDestinations.map((destination, index) => <div key={destination.id}><span className="destination-icon" style={{ background: destination.color }}>{index === 0 ? <Landmark size={19} /> : index === 1 ? <PiggyBank size={19} /> : destination.name.slice(0, 1)}</span><p><b>{destination.name}</b><small>{data.rules.filter((rule) => rule.destination_id === destination.id).length} regla(s)</small></p><strong>{euro.format(destination.total ?? 0)}</strong></div>) : <p className="empty-state">Añade una regla para empezar el reparto.</p>}</div>
              <button className="text-button" onClick={() => setRulesOpen(true)}>Ver y editar reglas</button>
            </article>
          </section>

          <section className="panel movements-panel">
            <div className="panel-title"><div><p className="eyebrow">Historial</p><h2>Movimientos de {selectedYear}</h2></div><span className="record-count">{data.entries.length} registros</span></div>
            {data.entries.length ? <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Quién</th><th>Ganado</th>{activeDestinations.map((destination) => <th key={destination.id}>{destination.name}</th>)}<th>Total</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.id}><td>{day.format(new Date(`${entry.income_date}T12:00:00`))}</td><td>{entry.concept}</td><td><span className={`person ${entry.person_name.toLowerCase()}`}>{entry.person_name}</span></td><td>{euro.format(entry.amount)}</td>{activeDestinations.map((destination) => <td key={destination.id}>{euro.format(entry.allocations[String(destination.id)] ?? 0)}</td>)}<td><strong>{euro.format(entry.contribution)}</strong></td><td><div className="row-actions"><button onClick={() => editIncome(entry)} aria-label={`Editar ${entry.concept}`}><Pencil size={15} /></button><button onClick={() => void deleteIncome(entry)} aria-label={`Eliminar ${entry.concept}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state large"><CirclePlus size={24} /><b>Todavía no hay movimientos</b><span>Añade el primer ingreso de {selectedYear}.</span></div>}
          </section>
        </>}
      </main>

      {rulesOpen && data && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setRulesOpen(false); }}><section className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title"><button className="modal-close" onClick={() => setRulesOpen(false)} aria-label="Cerrar"><X size={19} /></button><p className="eyebrow">Configuración de {selectedYear}</p><h2 id="rules-title">Reglas de reparto</h2><p className="modal-intro">Cada ingreso aplica las reglas activas en su fecha. Las reglas para una persona se suman a las de “Ambos”.</p><form className="rule-form" onSubmit={saveRule}><label><span>Destino</span><select value={ruleForm.destinationId} onChange={(event) => setRuleForm({ ...ruleForm, destinationId: event.target.value })}>{data.destinations.map((destination) => <option value={destination.id} key={destination.id}>{destination.name}</option>)}</select></label><label><span>Porcentaje</span><div className="suffix-input"><input required inputMode="decimal" placeholder="7" value={ruleForm.percentage} onChange={(event) => setRuleForm({ ...ruleForm, percentage: event.target.value })} /><b>%</b></div></label><label><span>Desde</span><input type="date" required value={ruleForm.dateFrom} onChange={(event) => setRuleForm({ ...ruleForm, dateFrom: event.target.value })} /></label><label><span>Hasta</span><input type="date" required value={ruleForm.dateTo} onChange={(event) => setRuleForm({ ...ruleForm, dateTo: event.target.value })} /></label><label className="wide"><span>Aplica a</span><select value={ruleForm.personId} onChange={(event) => setRuleForm({ ...ruleForm, personId: event.target.value })}><option value="">Ambos</option>{data.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><button className="primary-button wide"><Plus size={16} /> Añadir regla</button></form><div className="rules-list">{data.rules.map((rule) => <div className="rule-row" key={rule.id}><i style={{ background: data.destinations.find((item) => item.id === rule.destination_id)?.color }} /><div><b>{rule.destination_name} · {(rule.rate_bps / 100).toLocaleString("es-ES")}%</b><span>{rule.date_from.split("-").reverse().join("/")} – {rule.date_to.split("-").reverse().join("/")} · {rule.person_name ?? "Ambos"}</span></div><button onClick={() => void deleteRule(rule)} aria-label={`Eliminar regla ${rule.destination_name}`}><Trash2 size={16} /></button></div>)}</div></section></div>}

      {yearOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setYearOpen(false); }}><section className="modal year-modal" role="dialog" aria-modal="true" aria-labelledby="year-title"><button className="modal-close" onClick={() => setYearOpen(false)} aria-label="Cerrar"><X size={19} /></button><p className="eyebrow">Nuevo ejercicio</p><h2 id="year-title">Crear un año</h2><p className="modal-intro">El año se crea vacío. Después puedes definir sus reglas de reparto.</p><form onSubmit={createYear}><label><span>Año</span><input type="number" min="2000" max="2200" required value={newYear} onChange={(event) => setNewYear(event.target.value)} /></label><button className="primary-button">Crear año</button></form></section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
