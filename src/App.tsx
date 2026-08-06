import { useState, useEffect, useCallback, useRef } from 'react'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc } from 'firebase/firestore'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import { auth, db } from './firebase'

// ─── TYPES ─────────────────────────────────────────────────────────────────

export type TxType = 'expense' | 'income'
export type AccountClass = 'cash' | 'reserve' | 'fixed' | 'variable' | 'trading'

export interface Transaction {
  id: string
  type: TxType
  value: number
  description: string
  category: string
  account: string
  accountId?: string
  date: string
  createdAt: number
  fixedExpenseId?: string
}

export interface AccountEntry {
  id: string
  account: string
  accountId?: string
  balance: number
  month: string
  createdAt: number
}

export interface AccountConfig {
  id: string
  name: string
  accountClass: AccountClass
  archived?: boolean
}

export interface Transfer {
  id: string
  amount: number
  fromAccount: string
  toAccount: string
  fromAccountId?: string
  toAccountId?: string
  month: string
  description: string
  createdAt: number
}

export interface FixedExpense {
  id: string
  name: string
  amount: number
  category: string
  account: string
  accountId?: string
  createdAt: number
}

const MONTHLY_INCOME = 0

const ACCOUNT_CLASS_LABELS: Record<AccountClass, string> = {
  cash: 'Caixa',
  reserve: 'Reserva',
  fixed: 'Renda fixa',
  variable: 'Variavel',
  trading: 'Trading',
}

const ACCOUNT_CLASS_COLORS: Record<AccountClass, string> = {
  cash: '#4E9EFF',
  reserve: '#00D1FF',
  fixed: '#00E5A0',
  variable: '#9B59FF',
  trading: '#FF9F43',
}

const DEFAULT_ALLOCATION_TARGETS: Record<AccountClass, number> = {
  cash: 0,
  reserve: 20,
  fixed: 20,
  variable: 40,
  trading: 15,
}

const generateAccountId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `acc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// O Firestore rejeita gravar qualquer campo com valor undefined (ex.:
// accountId quando a conta nao foi encontrada). Em vez de deixar cada
// addDoc/updateDoc lidar com isso, os campos opcionais passam por aqui
// antes de ir pro banco — assim um id nao resolvido so fica de fora do
// documento, em vez de travar a gravacao inteira silenciosamente.
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const cleaned = {} as T
  ;(Object.keys(obj) as (keyof T)[]).forEach(key => {
    if (obj[key] !== undefined) cleaned[key] = obj[key]
  })
  return cleaned
}

// So usada para migrar contas antigas (criadas antes de existir um campo
// unico de classe) — inferia a classe a partir do nome e do extinto campo
// "Tipo". Depois da migracao, toda conta ja tem accountClass explicito e
// essa seguir de heuristicas deixa de ser necessaria.
function inferLegacyAccountClass(name: string, legacyType?: 'cash' | 'investment' | 'external'): AccountClass {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (n.includes('reserva')) return 'reserve'
  if ((n.includes('nubank') || n.includes('wise')) && !n.includes('reserva')) return 'cash'
  if (n.includes('renda fixa') || n.includes('cdb') || n.includes('tesouro') || n.includes('selic')) return 'fixed'
  if (n.includes('clear') || n.includes('acoes') || n.includes('fii') || n.includes('b3')) return 'variable'
  if (n.includes('forex') || n.includes('prop') || n.includes('proprio')) return 'trading'
  if (legacyType === 'cash') return 'cash'
  if (legacyType === 'external') return 'trading'
  return 'fixed'
}

function isInvestmentClass(cls: AccountClass): boolean {
  return cls === 'reserve' || cls === 'fixed' || cls === 'variable'
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

const todayStr = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

const currentMonthKey = () => {
  const d = new Date()
  // O mes de referencia vira junto com o calendario (dia 01). O aviso "atualizar
  // todo dia 5 do mes" que aparece na tela Contas continua sendo so um lembrete
  // pro usuario — nao muda mais quando o app considera o mes fechado.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-')
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${months[parseInt(m)-1]}/${y.slice(2)}`
}

const prevMonthKey = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m-2, 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

const generateMonths = () => {
  const months = []
  const start = new Date(2026, 0, 1)
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  const cur = new Date(start)
  while (cur <= end) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`)
    cur.setMonth(cur.getMonth()+1)
  }
  return months.reverse()
}

const S = {
  app: { display:'flex', flexDirection:'column' as const, height:'100%', width:'100%', maxWidth:430, margin:'0 auto', background:'#0A0B0F', position:'relative' as const },
  screen: { flex:1, overflowY:'auto' as const, padding:'20px 16px 90px' },
  card: { background:'#13141A', border:'0.5px solid rgba(255,255,255,0.07)', borderRadius:16, padding:16, marginBottom:10 },
  label: { fontSize:11, color:'#4E9EFF', letterSpacing:'0.12em', textTransform:'uppercase' as const, marginBottom:4, fontFamily:"'DM Mono',monospace" },
  muted: { color:'rgba(255,255,255,0.4)', fontSize:12 },
  input: { width:'100%', padding:'12px 14px', background:'#1C1D25', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:12, color:'#fff', fontSize:15, outline:'none', marginBottom:12 },
  select: { width:'100%', padding:'12px 14px', background:'#1C1D25', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:12, color:'#fff', fontSize:15, outline:'none', marginBottom:12, appearance:'none' as const },
  btn: { width:'100%', padding:'14px', background:'#4E9EFF', border:'none', borderRadius:12, color:'#fff', fontSize:15, fontWeight:600, cursor:'pointer' },
  btnGhost: { width:'100%', padding:'12px', background:'transparent', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:12, color:'rgba(255,255,255,0.6)', fontSize:14, cursor:'pointer', marginTop:8 },
  nav: { position:'absolute' as const, bottom:0, left:0, right:0, background:'#0D0E14', borderTop:'0.5px solid rgba(255,255,255,0.07)', display:'grid', gridTemplateColumns:'repeat(5,1fr)', zIndex:100 },
  navBtn: { padding:'8px 0 6px', border:'none', background:'transparent', color:'rgba(255,255,255,0.3)', fontSize:9, fontFamily:"'DM Sans',sans-serif", cursor:'pointer', display:'flex', flexDirection:'column' as const, alignItems:'center', gap:3 },
}

// ─── HOOKS ─────────────────────────────────────────────────────────────────

function useAccountConfigs(uid: string) {
  const [configs, setConfigs] = useState<AccountConfig[]>([])

  const save = async (list: AccountConfig[]) => {
    const snap = await getDocs(collection(db,'users',uid,'config'))
    const cfg = snap.docs.find(d => d.data().id==='accountConfigs')
    if (cfg) await deleteDoc(doc(db,'users',uid,'config',cfg.id))
    await addDoc(collection(db,'users',uid,'config'), { id:'accountConfigs', list, createdAt:Date.now() })
    setConfigs(list)
  }

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db,'users',uid,'config'))
      const cfg = snap.docs.find(d => d.data().id==='accountConfigs')
      if (cfg) {
        const rawList = cfg.data().list as Array<AccountConfig & { type?: 'cash' | 'investment' | 'external' }>
        const needsMigration = rawList.some(c => !c.id || !c.accountClass)
        const migrated: AccountConfig[] = rawList.map(c => ({
          id: c.id || generateAccountId(),
          name: c.name,
          accountClass: c.accountClass || inferLegacyAccountClass(c.name, c.type),
          archived: c.archived,
        }))
        setConfigs(migrated)
        if (needsMigration) {
          // Contas antigas ganham aqui, uma unica vez e sem acao do
          // usuario, um id estavel e uma classe explicita — antes, a
          // classificacao vinha de duas fontes (Tipo + heuristica pelo
          // nome). Depois disso o campo Tipo antigo para de existir.
          await save(migrated)
        }
      }
    } catch {}
  }, [uid])

  useEffect(() => { load() }, [load])

  return { configs, save, reload: load }
}

function useCategories(uid: string) {
  const [categories, setCategories] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db,'users',uid,'config'))
      const cfg = snap.docs.find(d => d.data().id==='categories')
      if (cfg) setCategories(cfg.data().list as string[])
    } catch {}
  }, [uid])

  useEffect(() => { load() }, [load])

  const saveCategories = async (list: string[]) => {
    const snap = await getDocs(collection(db,'users',uid,'config'))
    const cfg = snap.docs.find(d => d.data().id==='categories')
    if (cfg) await deleteDoc(doc(db,'users',uid,'config',cfg.id))
    await addDoc(collection(db,'users',uid,'config'), { id:'categories', list, createdAt:Date.now() })
    setCategories(list)
  }

  const addCategory = async (cat: string) => {
    const normalized = cat.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!normalized || categories.includes(normalized)) return
    await saveCategories([...categories, normalized])
  }

  return { categories, saveCategories, addCategory }
}

function useAllocationTargets(uid: string) {
  const [targets, setTargets] = useState<Record<AccountClass, number>>(DEFAULT_ALLOCATION_TARGETS)

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db,'users',uid,'config'))
      const cfg = snap.docs.find(d => d.data().id==='allocationTargets')
      if (cfg) setTargets({ ...DEFAULT_ALLOCATION_TARGETS, ...(cfg.data().targets as Record<AccountClass, number>) })
    } catch {}
  }, [uid])

  useEffect(() => { load() }, [load])

  const save = async (next: Record<AccountClass, number>) => {
    const snap = await getDocs(collection(db,'users',uid,'config'))
    const cfg = snap.docs.find(d => d.data().id==='allocationTargets')
    if (cfg) await deleteDoc(doc(db,'users',uid,'config',cfg.id))
    await addDoc(collection(db,'users',uid,'config'), { id:'allocationTargets', targets: next, createdAt:Date.now() })
    setTargets(next)
  }

  return { targets, save }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function deduplicateEntries(entries: AccountEntry[]): AccountEntry[] {
  const seen = new Set<string>()
  return entries.filter(e => {
    const key = `${e.month}_${e.account}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Resolve a config de uma conta a partir de uma referencia { account, accountId }.
// Prioriza o id (estavel mesmo apos renomear); cai para o nome soh em
// registros antigos, gravados antes do id existir.
function resolveAccountConfig(ref: { account: string; accountId?: string }, configs: AccountConfig[]): AccountConfig | undefined {
  if (ref.accountId) {
    const byId = configs.find(c => c.id === ref.accountId)
    if (byId) return byId
  }
  return configs.find(c => c.name === ref.account)
}

function entryMatchesAccount(e: { account: string; accountId?: string }, cfg: AccountConfig): boolean {
  if (e.accountId) return e.accountId === cfg.id
  return e.account === cfg.name
}

// Saldo de uma conta num mes: usa o lancamento exato daquele mes quando
// existe. Se a conta estiver oculta (archived) e nao houver lancamento no
// mes (porque ela parou de aparecer no formulario mensal), usa o ultimo
// saldo conhecido em vez de tratar como zero — assim ocultar uma conta nao
// derruba o patrimonio do mes seguinte.
function balanceForMonth(entries: AccountEntry[], cfg: AccountConfig, month: string): number {
  const exact = entries.find(e => e.month === month && entryMatchesAccount(e, cfg))
  if (exact) return exact.balance
  if (!cfg.archived) return 0
  const prior = entries
    .filter(e => entryMatchesAccount(e, cfg) && e.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month))[0]
  return prior ? prior.balance : 0
}

function calcPatrimonio(entries: AccountEntry[], month: string, validAccounts: AccountConfig[]) {
  return validAccounts.reduce((s, cfg) => s + balanceForMonth(entries, cfg, month), 0)
}

function calcInvestimentos(entries: AccountEntry[], month: string, validAccounts: AccountConfig[]) {
  return validAccounts.filter(a => isInvestmentClass(a.accountClass)).reduce((s, cfg) => s + balanceForMonth(entries, cfg, month), 0)
}

function calcCaixa(entries: AccountEntry[], month: string, validAccounts: AccountConfig[]) {
  return validAccounts.filter(a => a.accountClass==='cash').reduce((s, cfg) => s + balanceForMonth(entries, cfg, month), 0)
}

function calcTrading(entries: AccountEntry[], month: string, validAccounts: AccountConfig[]) {
  return validAccounts.filter(a => a.accountClass==='trading').reduce((s, cfg) => s + balanceForMonth(entries, cfg, month), 0)
}

function isInvestmentTransferRef(account: string, accountId: string | undefined, relConfigs: AccountConfig[]): boolean {
  return relConfigs.some(cfg => (accountId ? accountId === cfg.id : account === cfg.name))
}

// Generaliza "quanto uma classe de conta rendeu/perdeu no mes, descontando
// o que entrou/saiu por transferencia" — usada tanto pro rendimento de
// investimentos (reserva/renda fixa/variavel) quanto pro resultado de
// trading, que agora tambem compoe o patrimonio mas continua sendo
// acompanhado como resultado de operacoes, nao como rendimento passivo.
function calcResultadoClasse(
  entries: AccountEntry[],
  transfers: Transfer[],
  month: string,
  pmk: string,
  validAccounts: AccountConfig[],
  belongsToClasse: (cls: AccountClass) => boolean
) {
  const relConfigs = validAccounts.filter(a => belongsToClasse(a.accountClass))
  const atual = relConfigs.reduce((s, cfg) => s + balanceForMonth(entries, cfg, month), 0)
  const anterior = relConfigs.reduce((s, cfg) => s + balanceForMonth(entries, cfg, pmk), 0)
  const transferido = transfers
    .filter(t => t.month===month)
    .reduce((s, t) => {
      const entrou = isInvestmentTransferRef(t.toAccount, t.toAccountId, relConfigs)
      const saiu = isInvestmentTransferRef(t.fromAccount, t.fromAccountId, relConfigs)
      if (entrou && !saiu) return s + t.amount
      if (saiu && !entrou) return s - t.amount
      return s
    }, 0)
  return atual - anterior - transferido
}

function calcRendimento(
  entries: AccountEntry[],
  transfers: Transfer[],
  month: string,
  pmk: string,
  validAccounts: AccountConfig[]
) {
  return calcResultadoClasse(entries, transfers, month, pmk, validAccounts, isInvestmentClass)
}

function calcResultadoTrading(
  entries: AccountEntry[],
  transfers: Transfer[],
  month: string,
  pmk: string,
  validAccounts: AccountConfig[]
) {
  return calcResultadoClasse(entries, transfers, month, pmk, validAccounts, cls => cls === 'trading')
}

function calcAportes(
  transfers: Transfer[],
  month: string,
  validAccounts: AccountConfig[]
) {
  const invConfigs = validAccounts.filter(a => isInvestmentClass(a.accountClass))
  return transfers
    .filter(t => t.month === month)
    .reduce((s, t) => {
      const toInv = isInvestmentTransferRef(t.toAccount, t.toAccountId, invConfigs)
      const fromInv = isInvestmentTransferRef(t.fromAccount, t.fromAccountId, invConfigs)
      if (toInv && !fromInv) return s + t.amount
      if (fromInv && !toInv) return s - t.amount
      return s
    }, 0)
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────

function CategoryInput({ value, onChange, savedCategories, placeholder }: {
  value: string
  onChange: (v: string) => void
  savedCategories: string[]
  placeholder?: string
}) {
  const [focused, setFocused] = useState(false)
  const filtered = value.trim()
    ? savedCategories.filter(s => s.toLowerCase().startsWith(value.toLowerCase()) && s.toLowerCase()!==value.toLowerCase())
    : savedCategories.slice(0,6)

  return (
    <div style={{ position:'relative', marginBottom:12 }}>
      <input style={{ ...S.input, marginBottom:0 }} placeholder={placeholder||'Categoria...'} value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)} />
      {focused && filtered.length>0 && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:200, background:'#1C1D25', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:12, marginTop:4, overflow:'hidden' }}>
          {filtered.slice(0,6).map(s => (
            <div key={s} onMouseDown={() => onChange(s)} style={{ padding:'10px 14px', cursor:'pointer', fontSize:14, color:'rgba(255,255,255,0.8)', borderBottom:'0.5px solid rgba(255,255,255,0.05)' }}
              onMouseEnter={e => (e.currentTarget.style.background='rgba(78,158,255,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background='transparent')}>{s}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function TxRow({ tx, onDelete }: { tx: Transaction; onDelete?: () => void }) {
  const isInc = tx.type==='income'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'0.5px solid rgba(255,255,255,0.04)' }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:isInc?'#00E5A0':'#E24B4A', flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description}</div>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)' }}>{tx.category} | {tx.account} | {tx.date}</div>
      </div>
      <div style={{ fontSize:13, fontWeight:500, color:isInc?'#00E5A0':'#E24B4A', whiteSpace:'nowrap' }}>{isInc?'+':'-'}{fmt(tx.value)}</div>
      {onDelete && <button onClick={onDelete} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.2)', cursor:'pointer', fontSize:18, padding:'0 2px' }}>x</button>}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:36, height:36, border:'2px solid rgba(255,255,255,0.1)', borderTop:'2px solid #4E9EFF', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function MetricCard({ label, value, sub, subColor, accent }: { label: string; value: string; sub?: string; subColor?: string; accent?: string }) {
  return (
    <div style={{ background:'#13141A', border:`0.5px solid ${accent||'rgba(255,255,255,0.07)'}`, borderRadius:14, padding:'12px 14px' }}>
      <div style={{ fontSize:10, color:accent||'rgba(255,255,255,0.4)', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4, fontFamily:"'DM Mono',monospace" }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:600 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:subColor||'rgba(255,255,255,0.4)', marginTop:2 }}>{sub}</div>}
    </div>
  )
}

type AllocationItem = {
  key: string
  label: string
  short: string
  value: number
  color: string
  target?: number
}

function classifyAccount(ref: { account: string; accountId?: string }, configs: AccountConfig[]): AccountClass {
  const cfg = resolveAccountConfig(ref, configs)
  return cfg?.accountClass ?? inferLegacyAccountClass(ref.account)
}

function buildAllocationData(entries: AccountEntry[], month: string, configs: AccountConfig[], targets: Record<AccountClass, number> = DEFAULT_ALLOCATION_TARGETS): AllocationItem[] {
  const totals: Record<AccountClass, number> = { cash:0, reserve:0, fixed:0, variable:0, trading:0 }
  configs.forEach(cfg => {
    totals[cfg.accountClass] += balanceForMonth(entries, cfg, month)
  })

  return [
    { key:'cash', label:'Caixa', short:'Caixa', value:totals.cash, color:ACCOUNT_CLASS_COLORS.cash },
    { key:'reserve', label:'Reserva', short:'Reserva', value:totals.reserve, color:ACCOUNT_CLASS_COLORS.reserve, target:targets.reserve },
    { key:'fixed', label:'Renda fixa', short:'R. fixa', value:totals.fixed, color:ACCOUNT_CLASS_COLORS.fixed, target:targets.fixed },
    { key:'variable', label:'Variavel', short:'Variavel', value:totals.variable, color:ACCOUNT_CLASS_COLORS.variable, target:targets.variable },
    { key:'trading', label:'Trading', short:'Trading', value:totals.trading, color:ACCOUNT_CLASS_COLORS.trading, target:targets.trading },
  ]
}

function AllocationCard({ data, compact=false, editableTargets=false, onTargetChange }: { data: AllocationItem[]; compact?: boolean; editableTargets?: boolean; onTargetChange?: (key: AccountClass, target: number) => void }) {
  const rawData = data
  const data2 = rawData.filter(item => item.value > 0)
  const total = rawData.reduce((s, item) => s + item.value, 0)
  const aporte = total > 0
    ? rawData
      .filter(item => (item.target ?? 0) > 0)
      .map(item => {
        const pct = (item.value / total) * 100
        return { ...item, pct, gap:(item.target ?? 0) - pct }
      })
      .filter(item => item.gap > 0)
      .sort((a,b) => b.gap - a.gap)[0] ?? (data2.length > 0 ? [...data2].sort((a,b) => (a.value/total) - (b.value/total))[0] : null)
    : null

  return (
    <div style={{ ...S.card, border:'0.5px solid rgba(78,158,255,0.18)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:compact?10:14 }}>
        <div>
          <div style={S.label}>Alocacao atual</div>
          <div style={{ fontSize:compact?18:22, fontWeight:600 }}>{fmt(total)}</div>
        </div>
        {aporte && (
          <div style={{ textAlign:'right', maxWidth:135 }}>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', fontFamily:"'DM Mono',monospace", textTransform:'uppercase' }}>{'gap' in aporte ? 'Proximo aporte' : 'Menor peso'}</div>
            <div style={{ fontSize:12, color:aporte.color, fontWeight:600 }}>{aporte.short}</div>
            {'gap' in aporte && <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', marginTop:2 }}>Maior distancia da meta</div>}
          </div>
        )}
      </div>

      {total > 0 ? (
        <>
          <div style={{ display:'grid', gridTemplateColumns:compact?'82px 1fr':'104px 1fr', gap:14, alignItems:'center' }}>
            <div style={{ height:compact?82:104 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data2} dataKey="value" innerRadius={compact?25:32} outerRadius={compact?39:50} paddingAngle={3} stroke="none">
                    {data2.map(item => <Cell key={item.key} fill={item.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background:'#1C1D25',border:'none',borderRadius:10,color:'#fff',fontSize:12 }} formatter={(v: number) => [fmt(v)]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display:'grid', gap:8 }}>
              {data2.map(item => {
                const pct = total > 0 ? (item.value / total) * 100 : 0
                return (
                  <div key={item.key}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:4 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:item.color, flexShrink:0 }} />
                        <span style={{ fontSize:12, color:'rgba(255,255,255,0.72)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.label}</span>
                      </div>
                      <span style={{ fontSize:12, fontWeight:600, color:item.color }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{ height:6, background:'#1C1D25', borderRadius:999, overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:item.color, borderRadius:999 }} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:11, color:'rgba(255,255,255,0.38)', marginTop:3 }}>
                      <span>{fmt(item.value)}</span>
                      {item.target !== undefined && (
                        editableTargets && onTargetChange && item.key !== 'cash'
                          ? <label style={{ display:'flex', alignItems:'center', gap:4 }}>
                              Meta
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={item.target}
                                onChange={e => onTargetChange(item.key as AccountClass, Math.max(0, Math.min(100, Number(e.target.value)||0)))}
                                style={{ width:42, background:'transparent', border:'0.5px solid rgba(255,255,255,0.12)', borderRadius:6, color:'rgba(255,255,255,0.65)', fontSize:10, padding:'2px 4px', textAlign:'right' }}
                              />%
                            </label>
                          : <span>Meta {item.target}%</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ marginTop:12, padding:'10px 12px', background:'#1C1D25', borderRadius:10, color:'rgba(255,255,255,0.58)', fontSize:12, lineHeight:1.35 }}>
            Ajuste as metas e compare a distancia de cada classe antes de aportar.
          </div>
        </>
      ) : (
        <div style={{ ...S.muted, textAlign:'center', padding:'10px 0' }}>Cadastre os saldos para ver caixa, renda fixa e variavel.</div>
      )}
    </div>
  )
}

function FixedExpenseList({ fixedExpenses, isPaid, togglePaid, deleteFixed, editFixed, configs, savedCats }: {
  fixedExpenses: FixedExpense[]
  isPaid: (fx: FixedExpense) => boolean
  togglePaid: (fx: FixedExpense) => void
  deleteFixed: (id: string) => void
  editFixed: (id: string, fields: Partial<Omit<FixedExpense, 'id' | 'createdAt'>>) => Promise<void>
  configs: AccountConfig[]
  savedCats: string[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAmt, setEditAmt] = useState('')
  const [editCat, setEditCat] = useState('')
  const [editAccount, setEditAccount] = useState('')
  const [saving, setSaving] = useState(false)

  // Inclui contas ocultas aqui (diferente do formulario de "adicionar"),
  // pra nao sumir a conta de um gasto fixo antigo que ja foi arquivada.
  const accountNames = configs.map(c => c.name)

  const startEdit = (fx: FixedExpense) => {
    setEditingId(fx.id)
    setEditName(fx.name)
    setEditAmt(String(fx.amount))
    setEditCat(fx.category)
    setEditAccount(fx.account)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (id: string) => {
    const v = parseFloat(editAmt.replace(',', '.'))
    if (!editName.trim() || !v || v <= 0) return
    setSaving(true)
    const accCfg = configs.find(c => c.name === editAccount)
    await editFixed(id, { name: editName.trim(), amount: v, category: editCat.trim() || 'Fixo', account: editAccount, accountId: accCfg?.id })
    setSaving(false)
    setEditingId(null)
  }

  const sorted = [...fixedExpenses].sort((a,b) => a.category.localeCompare(b.category)||a.name.localeCompare(b.name))
  const groups: Record<string,FixedExpense[]> = {}
  sorted.forEach(fx => { if (!groups[fx.category]) groups[fx.category]=[]; groups[fx.category].push(fx) })

  return (
    <>
      {Object.entries(groups).map(([cat,items]) => (
        <div key={cat}>
          <div style={{ fontSize:10, color:'#4E9EFF', letterSpacing:'0.1em', textTransform:'uppercase', fontFamily:"'DM Mono',monospace", padding:'10px 0 4px' }}>{cat}</div>
          {items.map(fx => {
            const paid = isPaid(fx)
            const isEditing = editingId === fx.id
            return (
              <div key={fx.id}>
                <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom: isEditing ? 'none' : '0.5px solid rgba(255,255,255,0.05)' }}>
                  <button onClick={() => togglePaid(fx)} style={{ width:24, height:24, borderRadius:6, border:'none', cursor:'pointer', flexShrink:0, background:paid?'#00E5A0':'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {paid && <span style={{ color:'#0A0B0F', fontSize:14, fontWeight:700 }}>&#10003;</span>}
                  </button>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:paid?'rgba(255,255,255,0.4)':'#fff', textDecoration:paid?'line-through':'none' }}>{fx.name}</div>
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}>{fx.account||''}</div>
                  </div>
                  <div style={{ fontSize:13, fontWeight:500, color:paid?'rgba(255,255,255,0.35)':'#E24B4A' }}>{fmt(fx.amount)}</div>
                  <button onClick={() => isEditing ? cancelEdit() : startEdit(fx)} style={{ background:'none', border:'none', color:isEditing?'#4E9EFF':'rgba(255,255,255,0.35)', cursor:'pointer', fontSize:13, padding:'0 2px' }}>✏️</button>
                  <button onClick={() => deleteFixed(fx.id)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.2)', cursor:'pointer', fontSize:16, padding:'0 2px' }}>x</button>
                </div>
                {isEditing && (
                  <div style={{ background:'#1C1D25', borderRadius:12, padding:14, marginBottom:8, border:'0.5px solid rgba(78,158,255,0.25)' }}>
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Nome</div>
                    <input style={S.input} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nome do gasto" />
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Valor (R$)</div>
                    <input style={S.input} type="text" inputMode="decimal" value={editAmt} onChange={e => setEditAmt(e.target.value)} placeholder="0,00" />
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Categoria</div>
                    <CategoryInput value={editCat} onChange={setEditCat} savedCategories={savedCats} placeholder="Categoria..." />
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Conta</div>
                    <select style={{ ...S.select, marginBottom:12 }} value={editAccount} onChange={e => setEditAccount(e.target.value)}>
                      {accountNames.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <button style={{ ...S.btn, opacity:saving?0.6:1 }} onClick={() => saveEdit(fx.id)} disabled={saving}>{saving?'Salvando...':'Salvar alteracoes'}</button>
                      <button style={{ ...S.btnGhost, marginTop:0 }} onClick={cancelEdit}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

function CategoriesManager({ uid, savedCats, onSave }: { uid: string; savedCats: string[]; onSave: (list: string[]) => Promise<void> }) {
  const [list, setList] = useState<string[]>([...savedCats])
  const [newCat, setNewCat] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setList([...savedCats]) }, [savedCats])

  const add = () => {
    const n = newCat.trim().replace(/\b\w/g,c=>c.toUpperCase())
    if (!n||list.includes(n)) return
    setList(prev => [...prev,n]); setNewCat('')
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(list)
      setMsg('Salvo!')
    } catch {
      setMsg('Erro ao salvar. Tente novamente.')
    } finally {
      setTimeout(() => setMsg(''),2500)
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ ...S.label, marginBottom:10 }}>Gerenciar categorias</div>
      <div style={S.card}>
        {list.length===0
          ? <div style={{ ...S.muted, textAlign:'center', padding:'12px 0' }}>Nenhuma categoria</div>
          : list.map((cat,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'0.5px solid rgba(255,255,255,0.05)' }}>
              <div style={{ flex:1, fontSize:13 }}>{cat}</div>
              <button onClick={() => setList(prev => prev.filter((_,idx)=>idx!==i))} style={{ background:'none', border:'none', color:'#E24B4A', cursor:'pointer', fontSize:18, padding:'0 4px' }}>x</button>
            </div>
          ))
        }
        <div style={{ borderTop:list.length>0?'0.5px solid rgba(255,255,255,0.08)':'none', paddingTop:12, marginTop:list.length>0?8:0, display:'flex', gap:8 }}>
          <input style={{ ...S.input, marginBottom:0, flex:1 }} placeholder="Nova categoria..." value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key==='Enter'&&add()} />
          <button onClick={add} style={{ padding:'12px 16px', background:'#13141A', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:12, color:'#4E9EFF', fontSize:18, cursor:'pointer' }}>+</button>
        </div>
      </div>
      {msg && <div style={{ textAlign:'center', color:msg==='Salvo!'?'#00E5A0':'#E24B4A', fontSize:13, margin:'8px 0' }}>{msg}</div>}
      <button style={{ ...S.btn, opacity:saving?0.6:1 }} onClick={save} disabled={saving}>{saving?'Salvando...':'Salvar categorias'}</button>
    </div>
  )
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [isReg, setIsReg] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setErr(''); setLoading(true)
    try {
      if (isReg) await createUserWithEmailAndPassword(auth, email, pass)
      else await signInWithEmailAndPassword(auth, email, pass)
    } catch (e: unknown) {
      const code = (e as {code?:string}).code??''
      const msgs: Record<string,string> = {
        'auth/invalid-email':'E-mail invalido','auth/wrong-password':'Senha incorreta',
        'auth/user-not-found':'Usuario nao encontrado','auth/email-already-in-use':'E-mail ja cadastrado',
        'auth/weak-password':'Senha fraca (min. 6 caracteres)','auth/invalid-credential':'E-mail ou senha incorretos',
      }
      setErr(msgs[code]||'Erro ao entrar.')
    }
    setLoading(false)
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', padding:'32px 24px', background:'#0A0B0F' }}>
      <div style={{ marginBottom:40 }}>
        <div style={{ fontSize:11, color:'#4E9EFF', letterSpacing:'0.15em', textTransform:'uppercase', fontFamily:"'DM Mono',monospace", marginBottom:8 }}>Financeiro Pessoal</div>
        <div style={{ fontSize:28, fontWeight:600, letterSpacing:'-0.02em' }}>{isReg?'Criar conta':'Bem-vindo'}</div>
      </div>
      <input style={S.input} placeholder="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input style={S.input} placeholder="Senha" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key==='Enter'&&handle()} />
      {err && <div style={{ color:'#E24B4A', fontSize:13, marginBottom:12, textAlign:'center' }}>{err}</div>}
      <button style={{ ...S.btn, opacity:loading?0.6:1 }} onClick={handle} disabled={loading}>{loading?'Aguarde...':isReg?'Criar conta':'Entrar'}</button>
      <button style={S.btnGhost} onClick={() => {setIsReg(!isReg);setErr('')}}>{isReg?'Ja tenho conta':'Criar nova conta'}</button>
    </div>
  )
}

// ─── PAINEL ────────────────────────────────────────────────────────────────

function PainelScreen({ uid }: { uid: string }) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const { configs } = useAccountConfigs(uid)
  const mk = currentMonthKey()
  const pmk = prevMonthKey(mk)

  const load = useCallback(async () => {
    const [txSnap, entSnap, trSnap] = await Promise.all([
      getDocs(query(collection(db,'users',uid,'transactions'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'accountEntries'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'transfers'), orderBy('createdAt','desc'))),
    ])
    setTxs(txSnap.docs.map(d => ({id:d.id,...d.data()} as Transaction)))
    setEntries(deduplicateEntries(entSnap.docs.map(d => ({id:d.id,...d.data()} as AccountEntry))))
    setTransfers(trSnap.docs.map(d => ({id:d.id,...d.data()} as Transfer)))
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load])

  // Usa o mesmo "mes de referencia" (com a folga de 5 dias) que as telas de
  // Contas e Relatorio, em vez do mes de calendario puro. Antes, essa tela
  // calculava receita/despesa do mes atual do calendario enquanto o
  // patrimonio/rendimento abaixo usavam mk — nos primeiros dias do mes isso
  // fazia os dois blocos mostrarem numeros de meses diferentes.
  const [mkYear, mkMonthNum] = mk.split('-').map(Number)
  const thisMonthTxs = txs.filter(t => {
    const p = t.date.split('/')
    return parseInt(p[1])===mkMonthNum && parseInt(p[2])===mkYear
  })

  const totalReceita = thisMonthTxs.filter(t => t.type==='income').reduce((s,t) => s+t.value, 0)

  const patrimonio = calcPatrimonio(entries, mk, configs)
  const patrimonioPrev = calcPatrimonio(entries, pmk, configs)
  const investimentosPrev = calcInvestimentos(entries, pmk, configs)
  const rendimento = calcRendimento(entries, transfers, mk, pmk, configs)
  const resultadoTrading = calcResultadoTrading(entries, transfers, mk, pmk, configs)
  const rendimentoPct = investimentosPrev > 0 ? (rendimento / investimentosPrev) * 100 : 0
  const varPatrimonio = patrimonioPrev > 0 ? ((patrimonio - patrimonioPrev) / patrimonioPrev) * 100 : 0
  const meta10pct = investimentosPrev * (10 / 12 / 100)

  // Metas de alocacao agora ficam no Firestore (antes eram so localStorage,
  // e nao sincronizavam entre dispositivos). O debounce evita gravar a cada
  // digito quando o usuario ajusta a meta no campo numerico.
  const { targets: savedAllocationTargets, save: saveAllocationTargets } = useAllocationTargets(uid)
  const [allocationTargets, setAllocationTargets] = useState<Record<AccountClass, number>>(savedAllocationTargets)
  useEffect(() => { setAllocationTargets(savedAllocationTargets) }, [savedAllocationTargets])
  const targetSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateAllocationTarget = (key: AccountClass, target: number) => {
    if (key === 'cash') return
    const next = { ...allocationTargets, [key]: target }
    setAllocationTargets(next)
    if (targetSaveTimer.current) clearTimeout(targetSaveTimer.current)
    targetSaveTimer.current = setTimeout(() => { saveAllocationTargets(next) }, 600)
  }

  const allocationData = buildAllocationData(entries, mk, configs, allocationTargets)

  const evolucaoPatrimonio = patrimonio - patrimonioPrev
  // Trading agora compoe o patrimonio, entao a evolucao do mes inclui o
  // resultado das operacoes — precisa ser descontado aqui tambem, senao um
  // lucro/perda de trading aparece como "despesa" negativa/positiva por engano.
  const saldo = totalReceita - (evolucaoPatrimonio - rendimento - resultadoTrading)

  const allMonths = [...new Set(entries.map(e => e.month))].sort().slice(-6)
  const chartData = allMonths.map(m => {
    const prev = prevMonthKey(m)
    const patrimonioMes = calcPatrimonio(entries, m, configs)
    const patrimonioPrevMes = calcPatrimonio(entries, prev, configs)
    const rendimentoMes = calcRendimento(entries, transfers, m, prev, configs)
    const resultadoTradingMes = calcResultadoTrading(entries, transfers, m, prev, configs)
    const [mY, mM] = m.split('-').map(Number)
    const receitaMes = txs.filter(t => {
      const p = t.date.split('/')
      return t.type==='income' && parseInt(p[1])===mM && parseInt(p[2])===mY
    }).reduce((s,t) => s+t.value, 0)
    return {
      name: monthLabel(m),
      patrimonio: patrimonioMes,
      investimentos: calcInvestimentos(entries, m, configs),
      variacao: patrimonioMes - patrimonioPrevMes,
      // Mesma logica do card "Despesa" do mes atual: receita menos a
      // variacao de patrimonio (ja descontado rendimento e resultado de
      // trading) — nao e soma dos gastos lancados, ja que nem todo gasto e
      // lancado manualmente.
      despesa: receitaMes - ((patrimonioMes - patrimonioPrevMes) - rendimentoMes - resultadoTradingMes),
    }
  })

  const catMap: Record<string,number> = {}
  thisMonthTxs.filter(t => t.type==='expense').forEach(t => { catMap[t.category]=(catMap[t.category]||0)+t.value })
  const catData = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,5).map(([cat,total]) => ({cat,total}))

  if (loading) return <LoadingScreen />

  return (
    <div style={S.screen}>
      

      <div style={S.card}>
  <div style={S.label}>Patrimônio Total</div>

  <div
    style={{
      fontSize: 36,
      fontWeight: 700,
      marginTop: 6,
      marginBottom: 20,
      letterSpacing: '-0.03em'
    }}
  >
    {fmt(patrimonio)}
  </div>

  <div
    style={{
      background: '#1C1D25',
      borderRadius: 14,
      padding: 16,
      marginBottom: 12
    }}
  >
    <div
      style={{
        fontSize: 10,
        color: '#4E9EFF',
        fontFamily: "'DM Mono', monospace",
        textTransform: 'uppercase',
        marginBottom: 6
      }}
    >
      Evolução do mês
    </div>

    <div
      style={{
        fontSize: 28,
        fontWeight: 700,
        color: evolucaoPatrimonio >= 0 ? '#00E5A0' : '#E24B4A'
      }}
    >
      {fmt(evolucaoPatrimonio)}
    </div>

    <div
      style={{
        marginTop: 4,
        fontSize: 12,
        color: varPatrimonio >= 0 ? '#00E5A0' : '#E24B4A'
      }}
    >
      {fmtPct(varPatrimonio)} em relação ao mês anterior
    </div>
  </div>

  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10
    }}
  >
    <div
      style={{
        background: 'rgba(0,229,160,0.08)',
        borderRadius: 12,
        padding: 12
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#00E5A0',
          fontFamily: "'DM Mono', monospace",
          textTransform: 'uppercase'
        }}
      >
        Receita
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 20,
          fontWeight: 700
        }}
      >
        {fmt(totalReceita)}
      </div>
    </div>

    <div
      style={{
        background: 'rgba(226,75,74,0.08)',
        borderRadius: 12,
        padding: 12
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: '#E24B4A',
          fontFamily: "'DM Mono', monospace",
          textTransform: 'uppercase'
        }}
      >
        Despesa
      </div>

      <div
        style={{
          marginTop: 4,
          fontSize: 20,
          fontWeight: 700
        }}
      >
        {fmt(saldo)}
            </div>
    </div>
  </div>
</div>

      <AllocationCard data={allocationData} editableTargets onTargetChange={updateAllocationTarget} />
      
      {investimentosPrev > 0 && (
        <div style={{ ...S.card, border:'0.5px solid rgba(0,229,160,0.2)' }}>
          <div style={{ ...S.label, color:'#00E5A0' }}>Rendimento dos investimentos</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginTop:8 }}>
            <div style={{ background:'#1C1D25', borderRadius:10, padding:10 }}>
              <div style={S.muted}>Rendimento</div>
              <div style={{ fontSize:14, fontWeight:500, color:rendimento>=0?'#00E5A0':'#E24B4A', marginTop:2 }}>{rendimento>=0?'+':''}{fmt(rendimento)}</div>
            </div>
            <div style={{ background:'#1C1D25', borderRadius:10, padding:10 }}>
              <div style={S.muted}>%</div>
              <div style={{ fontSize:14, fontWeight:500, color:rendimentoPct>=0?'#00E5A0':'#E24B4A', marginTop:2 }}>{fmtPct(rendimentoPct)}</div>
            </div>
            <div style={{ background:'#1C1D25', borderRadius:10, padding:10 }}>
              <div style={S.muted}>Meta 10%</div>
              <div style={{ fontSize:14, fontWeight:500, color:rendimento>=meta10pct?'#00E5A0':'#FF9F43', marginTop:2 }}>{fmt(meta10pct)}</div>
            </div>
          </div>
        </div>
      )}

      {chartData.length > 1 && (
        <div style={S.card}>
          <div style={S.label}>Evolucao</div>
          <div style={{ height:190, marginTop:10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4E9EFF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4E9EFF" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00E5A0" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00E5A0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fill:'rgba(255,255,255,0.42)',fontSize:10 }} axisLine={false} tickLine={false} />
                <YAxis width={68} tick={{ fill:'rgba(255,255,255,0.35)',fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v/1000)}k`} />
                <Tooltip contentStyle={{ background:'#1C1D25',border:'none',borderRadius:10,color:'#fff',fontSize:12 }} formatter={(v: number) => [fmt(v)]} />
                <Area type="monotone" dataKey="patrimonio" name="Patrimonio" stroke="#4E9EFF" strokeWidth={2} fill="url(#gP)" />
                <Area type="monotone" dataKey="investimentos" name="Investimentos" stroke="#00E5A0" strokeWidth={1.5} fill="url(#gI)" strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display:'flex', gap:16, marginTop:4 }}>
            <span style={{ fontSize:10, color:'#4E9EFF' }}>Patrimonio</span>
            <span style={{ fontSize:10, color:'#00E5A0' }}>Investimentos</span>
          </div>
          <div style={{ display:'grid', gap:6, marginTop:12 }}>
            {chartData.map(row => (
              <div key={row.name} style={{ display:'grid', gridTemplateColumns:'48px 1fr auto', gap:8, alignItems:'center', fontSize:11, color:'rgba(255,255,255,0.55)' }}>
                <span>{row.name}</span>
                <span>{fmt(row.patrimonio)}</span>
                <span style={{ color:row.variacao>=0?'#00E5A0':'#E24B4A', fontWeight:600 }}>{row.variacao>=0?'+':''}{fmt(row.variacao)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {chartData.length > 1 && (
        <div style={S.card}>
          <div style={S.label}>Despesa por mes</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:2, marginBottom:4 }}>Estimada pela variacao do patrimonio, nao e a soma dos gastos lancados</div>
          <div style={{ height:150, marginTop:8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fill:'rgba(255,255,255,0.3)',fontSize:10 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background:'#1C1D25',border:'none',borderRadius:10,color:'#fff',fontSize:12 }} formatter={(v: number) => [fmt(v),'Despesa']} />
                <Bar dataKey="despesa" fill="#E24B4A" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display:'grid', gap:6, marginTop:10 }}>
            {chartData.map(row => (
              <div key={row.name} style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'rgba(255,255,255,0.55)' }}>
                <span>{row.name}</span>
                <span style={{ color:'#E24B4A', fontWeight:600 }}>{fmt(row.despesa)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {catData.length > 0 && (
        <div style={S.card}>
          <div style={S.label}>Top gastos do mes</div>
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:7 }}>
            {(() => {
              const max = catData[0]?.total || 1
              const colors = ['#4E9EFF','#7BB8FF','#5BC4F5','#4DD9C0','#6F8EFF']
              return catData.map((item, i) => {
                const pct = Math.max((item.total / max) * 100, 4)
                return (
                  <div key={item.cat} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:82, fontSize:11, color:'rgba(255,255,255,0.5)', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.cat}</div>
                    <div style={{ flex:1, position:'relative', height:22, background:'rgba(255,255,255,0.05)', borderRadius:6, overflow:'hidden' }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${pct}%`, background:colors[i % colors.length], borderRadius:6 }} />
                      <div style={{ position:'absolute', right:8, top:0, bottom:0, display:'flex', alignItems:'center', fontSize:11, fontWeight:600, color:'#fff', whiteSpace:'nowrap' }}>{fmt(item.total)}</div>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={{ ...S.label, marginBottom:10 }}>Ultimos lancamentos</div>
        {txs.slice(0,5).length===0
          ? <div style={{ ...S.muted, textAlign:'center', padding:'12px 0' }}>Nenhum lancamento ainda</div>
          : txs.slice(0,5).map(t => <TxRow key={t.id} tx={t} />)
        }
      </div>
    </div>
  )
}

// ─── GASTOS ────────────────────────────────────────────────────────────────

function GastosScreen({ uid }: { uid: string }) {
  const [tab, setTab] = useState<'add'|'fixos'|'list'|'cats'>('add')
  const [txs, setTxs] = useState<Transaction[]>([])
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [valor, setValor] = useState('')
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState('')
  const [conta, setConta] = useState('')
  const [data, setData] = useState(todayStr())
  const [msg, setMsg] = useState('')
  const [newFixName, setNewFixName] = useState('')
  const [newFixAmt, setNewFixAmt] = useState('')
  const [newFixCat, setNewFixCat] = useState('')
  const [newFixAccount, setNewFixAccount] = useState('')
  const [fixMsg, setFixMsg] = useState('')
  const { configs } = useAccountConfigs(uid)
  const { categories: savedCats, saveCategories, addCategory } = useCategories(uid)
  const mk = currentMonthKey()

  // So contas ativas entram nos formularios de novo lancamento. As ocultas
  // continuam existindo em configs (com historico intacto), so nao aparecem
  // aqui pra nao serem escolhidas por engano.
  const accountNames = configs.filter(c => !c.archived).map(c => c.name)

  const load = useCallback(async () => {
    const [txSnap, fxSnap] = await Promise.all([
      getDocs(query(collection(db,'users',uid,'transactions'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'fixedExpenses'), orderBy('createdAt','asc'))),
    ])
    setTxs(txSnap.docs.map(d => ({id:d.id,...d.data()} as Transaction)))
    setFixedExpenses(fxSnap.docs.map(d => ({id:d.id,...d.data()} as FixedExpense)))
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (accountNames.length>0&&!conta) setConta(accountNames[0]) }, [accountNames, conta])

  const salvar = async () => {
    const v = parseFloat(valor.replace(',','.'))
    if (!v||v<=0||!desc.trim()) { setMsg('Preencha valor e descricao'); return }
    setSaving(true)
    const normalizedCat = (cat.trim()||'Outros').replace(/\b\w/g,c=>c.toUpperCase())
    try {
      const contaCfg = configs.find(c => c.name === conta)
      await Promise.all([
        addDoc(collection(db,'users',uid,'transactions'), stripUndefined({ type:'expense', value:v, description:desc.trim(), category:normalizedCat, account:conta, accountId:contaCfg?.id, date:data, createdAt:Date.now() })),
        addCategory(normalizedCat),
      ])
      setValor(''); setDesc(''); setCat(''); setMsg('Salvo!')
      load()
    } catch {
      setMsg('Erro ao salvar. Verifique sua conexao e tente novamente.')
    } finally {
      setTimeout(() => setMsg(''),2500); setSaving(false)
    }
  }

  const deletar = async (id: string) => { await deleteDoc(doc(db,'users',uid,'transactions',id)); load() }

  const addFixed = async () => {
    const v = parseFloat(newFixAmt.replace(',','.'))
    if (!newFixName.trim()||!v||v<=0) { setFixMsg('Preencha nome e valor'); return }
    try {
      const fixAccName = newFixAccount||accountNames[0]||''
      const fixAccCfg = configs.find(c => c.name === fixAccName)
      await addDoc(collection(db,'users',uid,'fixedExpenses'), stripUndefined({ name:newFixName.trim(), amount:v, category:newFixCat.trim()||'Fixo', account:fixAccName, accountId:fixAccCfg?.id, createdAt:Date.now() }))
      setNewFixName(''); setNewFixAmt(''); setNewFixCat(''); setNewFixAccount('')
      setFixMsg('Adicionado!')
      load()
    } catch {
      setFixMsg('Erro ao adicionar. Tente novamente.')
    } finally {
      setTimeout(() => setFixMsg(''),2500)
    }
  }

  const deleteFixed = async (id: string) => { await deleteDoc(doc(db,'users',uid,'fixedExpenses',id)); load() }

  const editFixed = async (id: string, fields: Partial<Omit<FixedExpense, 'id' | 'createdAt'>>) => {
    try {
      await updateDoc(doc(db,'users',uid,'fixedExpenses',id), stripUndefined(fields))
      setFixMsg('Gasto fixo atualizado!')
      load()
    } catch {
      setFixMsg('Erro ao atualizar. Tente novamente.')
    } finally {
      setTimeout(() => setFixMsg(''),2500)
    }
  }

  // Agora casa pelo id do gasto fixo (fixedExpenseId), nao mais so pelo texto
  // "[FIXO] nome" — assim editar o nome de um gasto fixo depois de marcado
  // como pago nao "perde" o status nem duplica o lancamento. Transacoes
  // antigas (sem fixedExpenseId) ainda sao reconhecidas pelo texto, por
  // compatibilidade.
  const isPaid = (fx: FixedExpense) => {
    const [y,m] = mk.split('-')
    return txs.some(t => (t.fixedExpenseId===fx.id || t.description===`[FIXO] ${fx.name}`) && t.date.endsWith(`/${m}/${y}`) && t.type==='expense')
  }

  const togglePaid = async (fx: FixedExpense) => {
    const [y,m] = mk.split('-')
    try {
      if (isPaid(fx)) {
        const tx = txs.find(t => (t.fixedExpenseId===fx.id || t.description===`[FIXO] ${fx.name}`) && t.date.endsWith(`/${m}/${y}`) && t.type==='expense')
        if (tx) await deleteDoc(doc(db,'users',uid,'transactions',tx.id))
      } else {
        const fxAccName = fx.account||accountNames[0]||''
        const fxAccId = fx.accountId ?? configs.find(c => c.name === fxAccName)?.id
        await addDoc(collection(db,'users',uid,'transactions'), stripUndefined({ type:'expense', value:fx.amount, description:`[FIXO] ${fx.name}`, category:fx.category, account:fxAccName, accountId:fxAccId, date:`01/${m}/${y}`, createdAt:Date.now(), fixedExpenseId: fx.id }))
      }
      load()
    } catch {
      setFixMsg('Erro ao atualizar. Tente novamente.')
      setTimeout(() => setFixMsg(''),2500)
    }
  }

  const expenseTxs = txs.filter(t => t.type==='expense')
  if (loading) return <LoadingScreen />

  return (
    <div style={S.screen}>
      <div style={{ display:'flex', gap:6, marginBottom:16 }}>
        {([['add','Novo'],['fixos','Fixos'],['list',`Hist. (${expenseTxs.length})`],['cats','Categ.']] as [string,string][]).map(([k,label]) => (
          <button key={k} onClick={() => setTab(k as typeof tab)} style={{ flex:1, padding:'10px 4px', borderRadius:10, border:'none', cursor:'pointer', fontSize:11, fontWeight:tab===k?600:400, background:tab===k?'#4E9EFF':'#13141A', color:tab===k?'#fff':'rgba(255,255,255,0.4)' }}>{label}</button>
        ))}
      </div>

      {tab==='add' && (
        <>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Valor (R$)</div>
          <input style={S.input} type="text" inputMode="decimal" placeholder="0,00" value={valor} onChange={e => setValor(e.target.value)} />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Descricao</div>
          <input style={S.input} placeholder="Ex: Mercado, Uber..." value={desc} onChange={e => setDesc(e.target.value)} />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Categoria</div>
          <CategoryInput value={cat} onChange={setCat} savedCategories={savedCats} placeholder="Ex: Alimentacao, Saude..." />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Conta</div>
          <select style={S.select} value={conta} onChange={e => setConta(e.target.value)}>
            {accountNames.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Data</div>
          <input style={S.input} placeholder="dd/mm/aaaa" value={data} onChange={e => setData(e.target.value)} />
          {msg && <div style={{ textAlign:'center', fontSize:13, color:msg==='Salvo!'?'#00E5A0':'#E24B4A', marginBottom:8 }}>{msg}</div>}
          <button style={{ ...S.btn, opacity:saving?0.6:1 }} onClick={salvar} disabled={saving}>{saving?'Salvando...':'Salvar gasto'}</button>
        </>
      )}

      {tab==='fixos' && (
        <>
          <div style={{ ...S.label, marginBottom:8 }}>Gastos fixos — {monthLabel(mk)}</div>
          {fixedExpenses.length===0
            ? <div style={{ ...S.muted, textAlign:'center', padding:'16px 0' }}>Nenhum gasto fixo cadastrado</div>
            : <div style={S.card}>
                <FixedExpenseList fixedExpenses={fixedExpenses} isPaid={isPaid} togglePaid={togglePaid} deleteFixed={deleteFixed} editFixed={editFixed} configs={configs} savedCats={savedCats} />
                <div style={{ paddingTop:10, borderTop:'0.5px solid rgba(255,255,255,0.08)', display:'flex', justifyContent:'space-between' }}>
                  <div style={S.muted}>Total</div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{fmt(fixedExpenses.reduce((s,f) => s+f.amount,0))}</div>
                </div>
              </div>
          }
          <div style={{ ...S.label, marginTop:16, marginBottom:8 }}>Adicionar gasto fixo</div>
          <div style={S.card}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Nome</div>
            <input style={S.input} placeholder="Ex: Aluguel, Luz..." value={newFixName} onChange={e => setNewFixName(e.target.value)} />
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Valor (R$)</div>
            <input style={S.input} type="text" inputMode="decimal" placeholder="0,00" value={newFixAmt} onChange={e => setNewFixAmt(e.target.value)} />
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Categoria</div>
            <CategoryInput value={newFixCat} onChange={setNewFixCat} savedCategories={savedCats} placeholder="Ex: Moradia..." />
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Conta</div>
            <select style={{ ...S.select, marginBottom:0 }} value={newFixAccount} onChange={e => setNewFixAccount(e.target.value)}>
              {accountNames.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {fixMsg && <div style={{ textAlign:'center', fontSize:12, color:fixMsg.includes('!')?'#00E5A0':'#E24B4A', margin:'8px 0' }}>{fixMsg}</div>}
            <button style={{ ...S.btn, marginTop:12 }} onClick={addFixed}>Adicionar</button>
          </div>
        </>
      )}

      {tab==='list' && (
        expenseTxs.length===0
          ? <div style={{ ...S.muted, textAlign:'center', padding:'40px 0' }}>Nenhum gasto</div>
          : <div style={S.card}>{expenseTxs.map(t => <TxRow key={t.id} tx={t} onDelete={() => deletar(t.id)} />)}</div>
      )}

      {tab==='cats' && (
        <CategoriesManager uid={uid} savedCats={savedCats} onSave={async (list) => { await saveCategories(list) }} />
      )}
    </div>
  )
}

// ─── RECEITAS ──────────────────────────────────────────────────────────────

function ReceitasScreen({ uid }: { uid: string }) {
  const [tab, setTab] = useState<'add'|'list'>('add')
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [valor, setValor] = useState('')
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState('')
  const [conta, setConta] = useState('')
  const [data, setData] = useState(todayStr())
  const [msg, setMsg] = useState('')
  const [filterMonth, setFilterMonth] = useState(currentMonthKey())
  const allMonths = generateMonths()
  const { configs } = useAccountConfigs(uid)
  const { categories: savedCats, addCategory } = useCategories(uid)
  const accountNames = configs.filter(c => !c.archived).map(c => c.name)

  const load = useCallback(async () => {
    const snap = await getDocs(query(collection(db,'users',uid,'transactions'), orderBy('createdAt','desc')))
    setTxs(snap.docs.map(d => ({id:d.id,...d.data()} as Transaction)).filter(t => t.type==='income'))
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (accountNames.length>0&&!conta) setConta(accountNames[0]) }, [accountNames, conta])

  const salvar = async () => {
    const v = parseFloat(valor.replace(',','.'))
    if (!v||v<=0||!desc.trim()) { setMsg('Preencha valor e descricao'); return }
    setSaving(true)
    const normalizedCat = (cat.trim()||'Receita').replace(/\b\w/g,c=>c.toUpperCase())
    try {
      const contaCfg = configs.find(c => c.name === conta)
      await Promise.all([
        addDoc(collection(db,'users',uid,'transactions'), stripUndefined({ type:'income', value:v, description:desc.trim(), category:normalizedCat, account:conta, accountId:contaCfg?.id, date:data, createdAt:Date.now() })),
        addCategory(normalizedCat),
      ])
      setValor(''); setDesc(''); setCat(''); setMsg('Salvo!')
      load()
    } catch {
      setMsg('Erro ao salvar. Verifique sua conexao e tente novamente.')
    } finally {
      setTimeout(() => setMsg(''),2500); setSaving(false)
    }
  }

  const deletar = async (id: string) => { await deleteDoc(doc(db,'users',uid,'transactions',id)); load() }

  const filtered = txs.filter(t => { const p=t.date.split('/'); return `${p[2]}-${p[1]}`===filterMonth })
  const totalFiltered = filtered.reduce((s,t) => s+t.value, 0)
  const monthMap: Record<string,number> = {}
  txs.forEach(t => { const p=t.date.split('/'); const mk=`${p[2]}-${p[1]}`; monthMap[mk]=(monthMap[mk]||0)+t.value })
  const chartData = Object.entries(monthMap).sort((a,b) => a[0].localeCompare(b[0])).slice(-6).map(([m,v]) => ({name:monthLabel(m),total:v}))

  if (loading) return <LoadingScreen />

  return (
    <div style={S.screen}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:16 }}>
        {([['add','Nova receita'],['list','Historico']] as const).map(([k,label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding:'10px', borderRadius:10, border:'none', cursor:'pointer', fontSize:14, fontWeight:tab===k?600:400, background:tab===k?'#00E5A0':'#13141A', color:tab===k?'#0A0B0F':'rgba(255,255,255,0.4)' }}>{label}</button>
        ))}
      </div>

      {tab==='add' && (
        <>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Valor (R$)</div>
          <input style={S.input} type="text" inputMode="decimal" placeholder="0,00" value={valor} onChange={e => setValor(e.target.value)} />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Descricao</div>
          <input style={S.input} placeholder="Ex: Salario, Lucro Prop Firm..." value={desc} onChange={e => setDesc(e.target.value)} />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Categoria</div>
          <CategoryInput value={cat} onChange={setCat} savedCategories={savedCats} placeholder="Ex: Salario, Dividendos..." />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Conta</div>
          <select style={S.select} value={conta} onChange={e => setConta(e.target.value)}>
            {accountNames.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Data</div>
          <input style={S.input} placeholder="dd/mm/aaaa" value={data} onChange={e => setData(e.target.value)} />
          {msg && <div style={{ textAlign:'center', fontSize:13, color:msg==='Salvo!'?'#00E5A0':'#E24B4A', marginBottom:8 }}>{msg}</div>}
          <button style={{ ...S.btn, background:'#00E5A0', color:'#0A0B0F', opacity:saving?0.6:1 }} onClick={salvar} disabled={saving}>{saving?'Salvando...':'Salvar receita'}</button>
        </>
      )}

      {tab==='list' && (
        <>
          {chartData.length>1 && (
            <div style={{ ...S.card, marginBottom:12 }}>
              <div style={S.label}>Receitas por mes</div>
              <div style={{ height:110, marginTop:8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" tick={{ fill:'rgba(255,255,255,0.3)',fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background:'#1C1D25',border:'none',borderRadius:10,color:'#fff',fontSize:12 }} formatter={(v: number) => [fmt(v),'Receitas']} />
                    <Bar dataKey="total" fill="#00E5A0" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...S.select, marginBottom:0, flex:1 }}>
              {allMonths.map(m => <option key={m} value={m} style={{ background:'#13141A' }}>{monthLabel(m)}</option>)}
            </select>
            <div style={{ fontSize:13, fontWeight:600, color:'#00E5A0', whiteSpace:'nowrap' }}>{fmt(totalFiltered)}</div>
          </div>
          {filtered.length===0
            ? <div style={{ ...S.muted, textAlign:'center', padding:'32px 0' }}>Nenhuma receita em {monthLabel(filterMonth)}</div>
            : <div style={S.card}>{filtered.map(t => <TxRow key={t.id} tx={t} onDelete={() => deletar(t.id)} />)}</div>
          }
        </>
      )}
    </div>
  )
}

// ─── TRANSFER HISTORY ──────────────────────────────────────────────────────

function TransferHistory({ transfers, configs, selectedMonth, onDelete, onUpdate }: {
  transfers: Transfer[]
  configs: AccountConfig[]
  selectedMonth: string
  onDelete: (id: string) => void
  onUpdate: (id: string, fields: Partial<Omit<Transfer, 'id'>>) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [editAmt, setEditAmt] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = (t: Transfer) => {
    setEditingId(t.id)
    setEditFrom(t.fromAccount)
    setEditTo(t.toAccount)
    setEditAmt(String(t.amount))
    setEditDesc(t.description)
  }

  const cancelEdit = () => setEditingId(null)

  const saveEdit = async (id: string) => {
    const v = parseFloat(editAmt.replace(',', '.'))
    if (!v || v <= 0 || !editFrom || !editTo || editFrom === editTo) return
    setSaving(true)
    const fromCfg = configs.find(c => c.name === editFrom)
    const toCfg = configs.find(c => c.name === editTo)
    try {
      await onUpdate(id, {
        amount: v,
        fromAccount: editFrom,
        toAccount: editTo,
        fromAccountId: fromCfg?.id,
        toAccountId: toCfg?.id,
        description: editDesc.trim() || `${editFrom} -> ${editTo}`,
      })
      setEditingId(null)
    } catch {
      // mantem o formulario aberto para o usuario tentar novamente
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ ...S.card, marginBottom: 12 }}>
      <div style={{ ...S.label, marginBottom: 12 }}>Transferencias de {monthLabel(selectedMonth)}</div>

      {transfers.map((t, idx) => {
        const fromClass = resolveAccountConfig({ account: t.fromAccount, accountId: t.fromAccountId }, configs)?.accountClass ?? 'cash'
        const toClass   = resolveAccountConfig({ account: t.toAccount, accountId: t.toAccountId }, configs)?.accountClass ?? 'cash'
        const isLast   = idx === transfers.length - 1
        const isEditing = editingId === t.id

        return (
          <div key={t.id} style={{ borderBottom: isLast && !isEditing ? 'none' : '0.5px solid rgba(255,255,255,0.05)' }}>
            {isEditing ? (
              <div style={{ padding: '12px 0' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>De</div>
                <select style={S.select} value={editFrom} onChange={e => setEditFrom(e.target.value)}>
                  {configs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Para</div>
                <select style={S.select} value={editTo} onChange={e => setEditTo(e.target.value)}>
                  {configs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Valor (R$)</div>
                <input style={S.input} type="text" inputMode="decimal" value={editAmt} onChange={e => setEditAmt(e.target.value)} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Descricao</div>
                <input style={{ ...S.input, marginBottom: 0 }} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => saveEdit(t.id)}
                    disabled={saving}
                    style={{ flex: 1, padding: '10px', background: '#4E9EFF', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    style={{ flex: 1, padding: '10px', background: 'transparent', border: '0.5px solid rgba(255,255,255,0.15)', borderRadius: 10, color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCOUNT_CLASS_COLORS[fromClass] }} />
                  <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCOUNT_CLASS_COLORS[toClass] }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {`${t.fromAccount} -> ${t.toAccount}`}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{t.description}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#00E5A0' }}>{fmt(t.amount)}</div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                    <button
                      onClick={() => startEdit(t)}
                      style={{ background: 'none', border: 'none', color: '#4E9EFF', cursor: 'pointer', fontSize: 11, padding: '0 2px', fontFamily: "'DM Mono',monospace" }}>
                      editar
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 16, padding: '0 2px' }}>x</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ ...S.muted, fontFamily: "'DM Mono',monospace" }}>
          {transfers.length} transferencia{transfers.length !== 1 ? 's' : ''}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {fmt(transfers.reduce((s, t) => s + t.amount, 0))}
        </div>
      </div>
    </div>
  )
}

// ─── CONTAS ────────────────────────────────────────────────────────────────

function ContasScreen({ uid }: { uid: string }) {
  const allMonths = generateMonths()
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey())
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [balances, setBalances] = useState<Record<string,string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editConfigs, setEditConfigs] = useState<AccountConfig[]>([])
  const [newAccName, setNewAccName] = useState('')
  const [newAccClass, setNewAccClass] = useState<AccountClass>('cash')
  const [showTransfer, setShowTransfer] = useState(false)
  const [trFrom, setTrFrom] = useState('')
  const [trTo, setTrTo] = useState('')
  const [trAmt, setTrAmt] = useState('')
  const [trDesc, setTrDesc] = useState('')
  const [trMsg, setTrMsg] = useState('')
  const { configs, save: saveConfigs } = useAccountConfigs(uid)
  const pmk = prevMonthKey(selectedMonth)

  const load = useCallback(async () => {
    const [entSnap, trSnap] = await Promise.all([
      getDocs(query(collection(db,'users',uid,'accountEntries'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'transfers'), orderBy('createdAt','desc'))),
    ])
    const raw = entSnap.docs.map(d => ({id:d.id,...d.data()} as AccountEntry))
    setEntries(deduplicateEntries(raw))
    setTransfers(trSnap.docs.map(d => ({id:d.id,...d.data()} as Transfer)))
    const current = deduplicateEntries(raw).filter(e => e.month===selectedMonth)
    const init: Record<string,string> = {}
    current.forEach(e => {
      const cfg = resolveAccountConfig(e, configs)
      init[cfg ? cfg.name : e.account] = String(e.balance)
    })
    setBalances(init)
  }, [uid, selectedMonth, configs])

  useEffect(() => { load() }, [load])
  useEffect(() => { setEditConfigs([...configs]) }, [configs])

  const salvar = async () => {
    setSaving(true)
    try {
      const curr = entries.filter(e => e.month===selectedMonth)
      await Promise.all(curr.map(e => deleteDoc(doc(db,'users',uid,'accountEntries',e.id))))
      await Promise.all(
        configs.map(cfg => {
          const v = parseFloat(balances[cfg.name]?.replace(',','.')||'0')
          if (isNaN(v)||v===0) return Promise.resolve()
          return addDoc(collection(db,'users',uid,'accountEntries'), { account:cfg.name, accountId:cfg.id, balance:v, month:selectedMonth, createdAt:Date.now() })
        }).filter(Boolean)
      )
      setMsg('Saldos salvos!')
      load()
    } catch {
      setMsg('Erro ao salvar. Verifique sua conexao e tente novamente.')
    } finally {
      setTimeout(() => setMsg(''),2500); setSaving(false)
    }
  }

  const saveAccountEdits = async () => {
    const cleaned = editConfigs.filter(c => c.name.trim())
    if (newAccName.trim()) cleaned.push({ id: generateAccountId(), name:newAccName.trim(), accountClass: newAccClass })
    try {
      await saveConfigs(cleaned)
      setNewAccName(''); setNewAccClass('cash'); setEditMode(false)
      setMsg('Contas atualizadas!')
    } catch {
      setMsg('Erro ao atualizar contas. Tente novamente.')
    } finally {
      setTimeout(() => setMsg(''),2500)
    }
  }

  const addTransfer = async () => {
    const v = parseFloat(trAmt.replace(',','.'))
    if (!v||v<=0||!trFrom||!trTo||trFrom===trTo) { setTrMsg('Preencha todos os campos'); return }
    try {
      const fromCfg = configs.find(c => c.name === trFrom)
      const toCfg = configs.find(c => c.name === trTo)
      await addDoc(collection(db,'users',uid,'transfers'), stripUndefined({ amount:v, fromAccount:trFrom, toAccount:trTo, fromAccountId:fromCfg?.id, toAccountId:toCfg?.id, month:selectedMonth, description:trDesc.trim()||`${trFrom} -> ${trTo}`, createdAt:Date.now() }))
      setTrAmt(''); setTrDesc(''); setTrMsg('Transferencia registrada!')
      setTimeout(() => { setTrMsg(''); setShowTransfer(false) }, 2000)
      load()
    } catch {
      setTrMsg('Erro ao registrar. Tente novamente.')
      setTimeout(() => setTrMsg(''), 2500)
    }
  }

  const deleteTransfer = async (id: string) => {
    await deleteDoc(doc(db,'users',uid,'transfers',id))
    load()
  }

  const prevEntries = entries.filter(e => e.month===pmk)
  const prevMap: Record<string,number> = {}
  prevEntries.forEach(e => {
    const cfg = resolveAccountConfig(e, configs)
    prevMap[cfg ? cfg.name : e.account] = e.balance
  })

  const totalAtual = calcPatrimonio(entries, selectedMonth, configs)
  const totalPrev = calcPatrimonio(prevEntries, pmk, configs)
  const diff = totalAtual - totalPrev
  const rendimento = calcRendimento(entries, transfers, selectedMonth, pmk, configs)
  const rendPct = calcInvestimentos(entries, pmk, configs) > 0 ? (rendimento / calcInvestimentos(entries, pmk, configs)) * 100 : 0
  const aportes = calcAportes(transfers, selectedMonth, configs)


  const allMonthsData = [...new Set(entries.map(e => e.month))].sort().slice(-6)
  const chartData = allMonthsData.map(m => ({ name:monthLabel(m), total:calcPatrimonio(entries,m,configs) }))

  const groupedConfigs = configs.filter(cfg => !cfg.archived).reduce((acc, cfg) => {
    if (!acc[cfg.accountClass]) acc[cfg.accountClass] = []
    acc[cfg.accountClass].push(cfg)
    return acc
  }, {} as Record<AccountClass, AccountConfig[]>)

  const monthTransfers = transfers.filter(t => t.month === selectedMonth).sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div style={S.screen}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
        <div>
          <div style={S.label}>Mes de referencia</div>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ background:'transparent', border:'none', color:'#fff', fontSize:20, fontWeight:600, cursor:'pointer', outline:'none', fontFamily:"'DM Sans',sans-serif" }}>
            {allMonths.map(m => <option key={m} value={m} style={{ background:'#13141A' }}>{monthLabel(m)}</option>)}
          </select>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:"'DM Mono',monospace" }}>atualizar todo dia 5 do mes</div>
        </div>
        <button onClick={() => { setEditMode(!editMode); setEditConfigs([...configs]) }} style={{ background:editMode?'#4E9EFF22':'#13141A', border:editMode?'0.5px solid #4E9EFF':'0.5px solid rgba(255,255,255,0.15)', color:editMode?'#4E9EFF':'rgba(255,255,255,0.5)', borderRadius:10, padding:'6px 12px', fontSize:11, cursor:'pointer' }}>
          {editMode?'Cancelar':'Editar contas'}
        </button>
      </div>

      {editMode ? (
        <div style={S.card}>
          <div style={{ ...S.label, marginBottom:12 }}>Gerenciar contas</div>
          {editConfigs.map((cfg,i) => (
            <div key={cfg.id ?? i} style={{ marginBottom:12, paddingBottom:12, borderBottom:'0.5px solid rgba(255,255,255,0.06)', opacity: cfg.archived ? 0.55 : 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <input style={{ ...S.input, marginBottom:0, flex:1 }} value={cfg.name} onChange={e => setEditConfigs(prev => prev.map((c,idx) => idx===i?{...c,name:e.target.value}:c))} />
                <button onClick={() => setEditConfigs(prev => prev.map((c,idx) => idx===i?{...c,archived:!c.archived}:c))} style={{ background:'none', border:'0.5px solid rgba(255,255,255,0.15)', borderRadius:8, color:cfg.archived?'#00E5A0':'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:11, padding:'8px 10px', flexShrink:0, whiteSpace:'nowrap' }}>
                  {cfg.archived ? 'Mostrar' : 'Ocultar'}
                </button>
                <button onClick={() => setEditConfigs(prev => prev.filter((_,idx) => idx!==i))} style={{ background:'none', border:'none', color:'#E24B4A', cursor:'pointer', fontSize:18, flexShrink:0 }}>x</button>
              </div>
              <select style={{ ...S.select, marginBottom:0, fontSize:12 }} value={cfg.accountClass} onChange={e => setEditConfigs(prev => prev.map((c,idx) => idx===i?{...c,accountClass:e.target.value as AccountClass}:c))}>
                <option value="cash">Caixa</option>
                <option value="reserve">Reserva</option>
                <option value="fixed">Renda fixa</option>
                <option value="variable">Variavel</option>
                <option value="trading">Trading</option>
              </select>
              {cfg.archived && <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', marginTop:6 }}>Oculta — nao aparece mais pra novos lancamentos, mas o historico continua contando no patrimonio.</div>}
            </div>
          ))}
          <div style={{ borderTop:'0.5px solid rgba(255,255,255,0.08)', paddingTop:12, marginTop:8 }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:6 }}>+ Nova conta</div>
            <input style={S.input} placeholder="Nome..." value={newAccName} onChange={e => setNewAccName(e.target.value)} />
            <select style={{ ...S.select, marginBottom:0, fontSize:12 }} value={newAccClass} onChange={e => setNewAccClass(e.target.value as AccountClass)}>
              <option value="cash">Caixa</option>
              <option value="reserve">Reserva</option>
              <option value="fixed">Renda fixa</option>
              <option value="variable">Variavel</option>
              <option value="trading">Trading</option>
            </select>
          </div>
          {msg && <div style={{ textAlign:'center', color:'#00E5A0', fontSize:13, margin:'8px 0' }}>{msg}</div>}
          <button style={{ ...S.btn, marginTop:14 }} onClick={saveAccountEdits}>Salvar</button>
        </div>
      ) : (
        <>
          {/* Resumo - Patrimonio */}
          <div style={{ marginBottom:8 }}>
            <MetricCard
              label="Patrimonio"
              value={fmt(totalAtual)}
              sub={`${diff >= 0 ? '+' : ''}${fmt(diff)} vs anterior`}
              subColor={diff >= 0 ? '#00E5A0' : '#E24B4A'}
            />
          </div>

          {/* Grafico */}
          {chartData.length>1 && (
            <div style={{ ...S.card, marginBottom:12 }}>
              <div style={S.label}>Historico</div>
              <div style={{ height:100, marginTop:8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00E5A0" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#00E5A0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fill:'rgba(255,255,255,0.3)',fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background:'#1C1D25',border:'none',borderRadius:10,color:'#fff',fontSize:12 }} formatter={(v: number) => [fmt(v)]} />
                    <Area type="monotone" dataKey="total" stroke="#00E5A0" strokeWidth={2} fill="url(#gC)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Botao de transferencia */}
          <button onClick={() => setShowTransfer(!showTransfer)} style={{ ...S.btnGhost, marginTop:0, marginBottom:10, fontSize:12 }}>
            {showTransfer ? 'Cancelar transferencia' : '+ Registrar transferencia entre contas'}
          </button>

          {/* Formulario de transferencia */}
          {showTransfer && (
            <div style={{ ...S.card, marginBottom:12 }}>
              <div style={{ ...S.label, marginBottom:10 }}>Transferencia</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>De</div>
              <select style={S.select} value={trFrom} onChange={e => setTrFrom(e.target.value)}>
                <option value="">Selecionar...</option>
                {configs.filter(c => !c.archived).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Para</div>
              <select style={S.select} value={trTo} onChange={e => setTrTo(e.target.value)}>
                <option value="">Selecionar...</option>
                {configs.filter(c => !c.archived).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Valor (R$)</div>
              <input style={S.input} type="text" inputMode="decimal" placeholder="0,00" value={trAmt} onChange={e => setTrAmt(e.target.value)} />
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginBottom:4 }}>Descricao (opcional)</div>
              <input style={{ ...S.input, marginBottom:0 }} placeholder="Ex: Aporte renda fixa..." value={trDesc} onChange={e => setTrDesc(e.target.value)} />
              {trMsg && <div style={{ textAlign:'center', color:'#00E5A0', fontSize:12, margin:'8px 0' }}>{trMsg}</div>}
              <button style={{ ...S.btn, marginTop:12 }} onClick={addTransfer}>Registrar transferencia</button>
            </div>
          )}

          {/* Historico de transferencias */}
          {monthTransfers.length > 0 && (
            <TransferHistory
              transfers={monthTransfers}
              configs={configs}
              selectedMonth={selectedMonth}
              onDelete={deleteTransfer}
              onUpdate={async (id, fields) => {
                await updateDoc(doc(db, 'users', uid, 'transfers', id), stripUndefined(fields))
                load()
              }}
            />
          )}

          {/* Saldos agrupados por classe */}
          <div style={S.card}>
            <div style={S.label}>Saldos de {monthLabel(selectedMonth)}</div>
            <div style={{ marginTop:12 }}>
              {(['cash','reserve','fixed','variable','trading'] as AccountClass[]).map(cls => {
                const group = groupedConfigs[cls]||[]
                if (group.length===0) return null
                return (
                  <div key={cls} style={{ marginBottom:16 }}>
                    <div style={{ fontSize:10, color:ACCOUNT_CLASS_COLORS[cls], letterSpacing:'0.1em', textTransform:'uppercase', fontFamily:"'DM Mono',monospace", marginBottom:8 }}>{ACCOUNT_CLASS_LABELS[cls]}</div>
                    {group.map(cfg => {
                      const prev = prevMap[cfg.name]
                      const curr = parseFloat(balances[cfg.name]?.replace(',','.')||'0')||0
                      const delta = prev!==undefined ? curr-prev : null
                      return (
                        <div key={cfg.name} style={{ marginBottom:12 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                            <div style={{ fontSize:13, fontWeight:500 }}>{cfg.name}</div>
                            {delta!==null && <div style={{ fontSize:11, color:delta>=0?'#00E5A0':'#E24B4A' }}>{delta>=0?'+':''}{fmt(delta)}</div>}
                          </div>
                          <input style={{ ...S.input, marginBottom:0 }} type="text" inputMode="decimal" placeholder="0,00"
                            value={balances[cfg.name]||''}
                            onChange={e => setBalances(prev => ({...prev,[cfg.name]:e.target.value}))} />
                          {prev!==undefined && <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', marginTop:2 }}>Anterior: {fmt(prev)}</div>}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            {configs.length===0 && <div style={{ ...S.muted, textAlign:'center', padding:'16px 0' }}>Clique em "Editar contas" para adicionar.</div>}
            {msg && <div style={{ textAlign:'center', color:'#00E5A0', fontSize:13, marginBottom:10 }}>{msg}</div>}
            <button style={{ ...S.btn, opacity:saving?0.6:1 }} onClick={salvar} disabled={saving}>{saving?'Salvando...':`Salvar saldos de ${monthLabel(selectedMonth)}`}</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── RELATÓRIO ─────────────────────────────────────────────────────────────

function RelatorioScreen({ uid }: { uid: string }) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [copied, setCopied] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey())
  const allMonths = generateMonths()
  const { configs } = useAccountConfigs(uid)
  const pmk = prevMonthKey(selectedMonth)

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db,'users',uid,'transactions'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'accountEntries'), orderBy('createdAt','desc'))),
      getDocs(query(collection(db,'users',uid,'transfers'), orderBy('createdAt','desc'))),
    ]).then(([txSnap,entSnap,trSnap]) => {
      setTxs(txSnap.docs.map(d => ({id:d.id,...d.data()} as Transaction)))
      setEntries(deduplicateEntries(entSnap.docs.map(d => ({id:d.id,...d.data()} as AccountEntry))))
      setTransfers(trSnap.docs.map(d => ({id:d.id,...d.data()} as Transfer)))
    })
  }, [uid])

  const [selY,selM] = selectedMonth.split('-').map(Number)
  const mTxs = txs.filter(t => { const p=t.date.split('/'); return parseInt(p[1])===selM&&parseInt(p[2])===selY })
  const totalGasto = mTxs.filter(t => t.type==='expense').reduce((s,t) => s+t.value,0)
  const totalReceita = mTxs.filter(t => t.type==='income').reduce((s,t) => s+t.value,0)
  const patrimonio = calcPatrimonio(entries,selectedMonth,configs)
  const patrimonioPrev = calcPatrimonio(entries,pmk,configs)
  const investimentos = calcInvestimentos(entries,selectedMonth,configs)
  const rendimento = calcRendimento(entries,transfers,selectedMonth,pmk,configs)
  const rendPct = calcInvestimentos(entries,pmk,configs)>0 ? (rendimento/calcInvestimentos(entries,pmk,configs))*100 : 0
  const meta10 = calcInvestimentos(entries,pmk,configs)*(10/12/100)
  const aportesMes = calcAportes(transfers, selectedMonth, configs)

  const catMap: Record<string,number> = {}
  mTxs.filter(t => t.type==='expense').forEach(t => { catMap[t.category]=(catMap[t.category]||0)+t.value })
  const top5 = mTxs.filter(t => t.type==='expense').sort((a,b) => b.value-a.value).slice(0,5)

  const mTransfers = transfers.filter(t => t.month===selectedMonth)

  const relatorio = `RELATORIO FINANCEIRO - ${monthLabel(selectedMonth)}
Gerado em ${todayStr()}

RECEITAS E GASTOS
Receitas: ${fmt(totalReceita)}
Gastos: ${fmt(totalGasto)}
Saldo: ${fmt(totalReceita-totalGasto)}

PATRIMONIO
Atual: ${fmt(patrimonio)}
Anterior: ${fmt(patrimonioPrev)}
Variacao: ${fmt(patrimonio-patrimonioPrev)}

INVESTIMENTOS
Total investido: ${fmt(investimentos)}
Aportes no mes: ${fmt(aportesMes)}
Rendimento real: ${fmt(rendimento)} (${fmtPct(rendPct)})
Meta 10% a.a.: ${fmt(meta10)}
${rendimento>=meta10?'Acima da meta':'Abaixo da meta'}

SALDOS POR CONTA
${entries.filter(e => e.month===selectedMonth && resolveAccountConfig(e, configs)).map(e => {
  const accountClass = classifyAccount(e, configs)
  return `- ${e.account} [${ACCOUNT_CLASS_LABELS[accountClass]}]: ${fmt(e.balance)}`
}).join('\n')}

${mTransfers.length>0?`TRANSFERENCIAS REGISTRADAS
${mTransfers.map(t => `- ${t.fromAccount} -> ${t.toAccount}: ${fmt(t.amount)} (${t.description})`).join('\n')}
`:''}
GASTOS POR CATEGORIA
${Object.entries(catMap).sort((a,b) => b[1]-a[1]).map(([c,v]) => `${c}: ${fmt(v)}`).join('\n')}

TOP 5 GASTOS
${top5.map((t,i) => `${i+1}. ${t.description} - ${fmt(t.value)} [${t.category}]`).join('\n')}

TODOS OS LANCAMENTOS
${mTxs.map(t => `${t.type==='income'?'+':'-'} ${fmt(t.value)} | ${t.description} | ${t.category} | ${t.date}`).join('\n')}
`

  return (
    <div style={S.screen}>
      <div style={{ marginBottom:16 }}>
        <div style={S.label}>Relatorio</div>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ background:'transparent', border:'none', color:'#fff', fontSize:20, fontWeight:600, cursor:'pointer', outline:'none', fontFamily:"'DM Sans',sans-serif" }}>
          {allMonths.map(m => <option key={m} value={m} style={{ background:'#13141A' }}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
        <MetricCard label="Patrimonio" value={fmt(patrimonio)} sub={`${(patrimonio-patrimonioPrev)>=0?'+':''}${fmt(patrimonio-patrimonioPrev)}`} subColor={(patrimonio-patrimonioPrev)>=0?'#00E5A0':'#E24B4A'} />
        <MetricCard label="Rendimento inv." value={fmt(rendimento)} sub={fmtPct(rendPct)} subColor={rendimento>=0?'#00E5A0':'#E24B4A'} accent="#00E5A0" />
        <MetricCard label="Receitas" value={fmt(totalReceita)} accent="#00E5A0" />
        <MetricCard label="Gastos" value={fmt(totalGasto)} accent="#E24B4A" />
      </div>

      <div style={S.card}>
        <div style={{ ...S.label, marginBottom:10 }}>Texto para IA</div>
        <div style={{ background:'#0D0E14', borderRadius:10, padding:12, fontFamily:"'DM Mono',monospace", fontSize:10.5, color:'rgba(255,255,255,0.6)', lineHeight:1.7, maxHeight:200, overflowY:'auto', whiteSpace:'pre-wrap' }}>{relatorio}</div>
        <button style={{ ...S.btn, marginTop:12, background:copied?'#00E5A0':'#4E9EFF' }} onClick={() => { navigator.clipboard.writeText(relatorio).then(() => { setCopied(true); setTimeout(() => setCopied(false),2500) }) }}>{copied?'Copiado!':'Copiar relatorio'}</button>
        <div style={{ ...S.muted, textAlign:'center', fontSize:11, marginTop:8 }}>Cole no ChatGPT ou Claude para analise</div>
      </div>
    </div>
  )
}

// ─── NAV ───────────────────────────────────────────────────────────────────

const navIcons: Record<string,string> = {
  painel:'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  gastos:'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
  receitas:'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z',
  contas:'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  relatorio:'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
}

const NavIcon = ({ type }: { type: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={navIcons[type]} /></svg>
)

// ─── APP ROOT ──────────────────────────────────────────────────────────────

type Screen = 'painel'|'gastos'|'receitas'|'contas'|'relatorio'

export default function App() {
  const [user, setUser] = useState<User|null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>('painel')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false) })
    return unsub
  }, [])

  if (authLoading) return <div style={{ height:'100vh', background:'#0A0B0F', display:'flex', alignItems:'center', justifyContent:'center' }}><LoadingScreen /></div>
  if (!user) return <div style={{ height:'100vh', background:'#0A0B0F' }}><LoginScreen /></div>

  const navItems: { key: Screen; label: string }[] = [
    { key:'painel', label:'Painel' },{ key:'gastos', label:'Gastos' },
    { key:'receitas', label:'Receitas' },{ key:'contas', label:'Contas' },{ key:'relatorio', label:'Relatorio' },
  ]

  return (
    <div style={{ height:'100vh', background:'#0A0B0F', display:'flex', justifyContent:'center' }}>
      <div style={S.app}>
        {screen==='painel' && <PainelScreen uid={user.uid} />}
        {screen==='gastos' && <GastosScreen uid={user.uid} />}
        {screen==='receitas' && <ReceitasScreen uid={user.uid} />}
        {screen==='contas' && <ContasScreen uid={user.uid} />}
        {screen==='relatorio' && <RelatorioScreen uid={user.uid} />}
        <nav style={S.nav}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setScreen(item.key)} style={{ ...S.navBtn, color:screen===item.key?'#4E9EFF':'rgba(255,255,255,0.3)' }}>
              <NavIcon type={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button onClick={() => signOut(auth)} style={{ position:'absolute', top:16, right:16, background:'none', border:'none', color:'rgba(255,255,255,0.2)', fontSize:11, cursor:'pointer', fontFamily:"'DM Mono',monospace" }}>sair</button>
      </div>
    </div>
  )
}
