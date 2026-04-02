import { useState, useEffect, useCallback } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
} from 'firebase/firestore'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { auth, db } from './firebase'
import type { Transaction, AccountEntry } from './types'
import { ACCOUNTS, CATEGORIES, MONTHLY_INCOME } from './types'

type Category = keyof typeof CATEGORIES

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const todayStr = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const currentMonthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-')
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${months[parseInt(m) - 1]}/${y.slice(2)}`
}

const prevMonthKey = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const S = {
  app: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', width: '100%', maxWidth: 430,
    margin: '0 auto', background: '#0A0B0F', position: 'relative' as const,
  },
  screen: { flex: 1, overflowY: 'auto' as const, padding: '20px 16px 90px' },
  card: {
    background: '#13141A', border: '0.5px solid rgba(255,255,255,0.07)',
    borderRadius: 16, padding: 16, marginBottom: 10,
  },
  label: {
    fontSize: 11, color: '#4E9EFF', letterSpacing: '0.12em',
    textTransform: 'uppercase' as const, marginBottom: 4,
    fontFamily: "'DM Mono', monospace",
  },
  bigVal: { fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' },
  muted: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  input: {
    width: '100%', padding: '12px 14px',
    background: '#1C1D25', border: '0.5px solid rgba(255,255,255,0.12)',
    borderRadius: 12, color: '#fff', fontSize: 15, outline: 'none', marginBottom: 12,
  },
  select: {
    width: '100%', padding: '12px 14px',
    background: '#1C1D25', border: '0.5px solid rgba(255,255,255,0.12)',
    borderRadius: 12, color: '#fff', fontSize: 15,
    outline: 'none', marginBottom: 12, appearance: 'none' as const,
  },
  btn: {
    width: '100%', padding: '14px', background: '#4E9EFF',
    border: 'none', borderRadius: 12, color: '#fff',
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  btnGhost: {
    width: '100%', padding: '12px', background: 'transparent',
    border: '0.5px solid rgba(255,255,255,0.15)', borderRadius: 12,
    color: 'rgba(255,255,255,0.6)', fontSize: 14, cursor: 'pointer', marginTop: 8,
  },
  nav: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    background: '#0D0E14', borderTop: '0.5px solid rgba(255,255,255,0.07)',
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', zIndex: 100,
  },
  navBtn: {
    padding: '10px 0 8px', border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.3)', fontSize: 10,
    fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4,
  },
}

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
      const code = (e as { code?: string }).code ?? ''
      const msgs: Record<string, string> = {
        'auth/invalid-email': 'E-mail inválido',
        'auth/wrong-password': 'Senha incorreta',
        'auth/user-not-found': 'Usuário não encontrado',
        'auth/email-already-in-use': 'E-mail já cadastrado',
        'auth/weak-password': 'Senha fraca (mín. 6 caracteres)',
        'auth/invalid-credential': 'E-mail ou senha incorretos',
      }
      setErr(msgs[code] || 'Erro ao entrar. Tente novamente.')
    }
    setLoading(false)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px', background: '#0A0B0F' }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: '#4E9EFF', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
          Financeiro Pessoal
        </div>
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {isReg ? 'Criar conta' : 'Bem-vindo de volta'}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
          {isReg ? 'Preencha os dados para começar' : 'Entre com seu e-mail e senha'}
        </div>
      </div>
      <input style={S.input} placeholder="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input style={S.input} placeholder="Senha" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handle()} />
      {err && <div style={{ color: '#E24B4A', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{err}</div>}
      <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} onClick={handle} disabled={loading}>
        {loading ? 'Aguarde...' : isReg ? 'Criar conta' : 'Entrar'}
      </button>
      <button style={S.btnGhost} onClick={() => { setIsReg(!isReg); setErr('') }}>
        {isReg ? 'Já tenho conta — entrar' : 'Criar nova conta'}
      </button>
    </div>
  )
}

function PainelScreen({ uid }: { uid: string }) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [loading, setLoading] = useState(true)
  const mk = currentMonthKey()
  const pmk = prevMonthKey(mk)

  const load = useCallback(async () => {
    const [txSnap, entSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'transactions'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'users', uid, 'accountEntries'), orderBy('createdAt', 'desc'))),
    ])
    setTxs(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
    setEntries(entSnap.docs.map(d => ({ id: d.id, ...d.data() } as AccountEntry)))
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const thisMonthTxs = txs.filter(t => {
    const parts = t.date.split('/')
    return parseInt(parts[1]) === now.getMonth() + 1 && parseInt(parts[2]) === now.getFullYear()
  })

  const totalGasto = thisMonthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.value, 0)
  const totalReceita = thisMonthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.value, 0)
  const renda = MONTHLY_INCOME + totalReceita
  const saldo = renda - totalGasto

  const currentEntries = entries.filter(e => e.month === mk)
  const prevEntries = entries.filter(e => e.month === pmk)
  const patrimonioAtual = currentEntries.reduce((s, e) => s + e.balance, 0)
  const patrimonioPrev = prevEntries.reduce((s, e) => s + e.balance, 0)
  const rendimentoRS = patrimonioAtual - patrimonioPrev
  const varPatrimonio = patrimonioPrev > 0 ? ((patrimonioAtual - patrimonioPrev) / patrimonioPrev) * 100 : 0
  const meta10pct = patrimonioPrev * (10 / 12 / 100)

  const catTotals = (Object.keys(CATEGORIES) as Category[]).map(cat => ({
    cat,
    total: thisMonthTxs.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.value, 0),
    color: CATEGORIES[cat].color,
    budget: CATEGORIES[cat].budget,
  })).filter(c => c.total > 0)

  const allMonths = [...new Set(entries.map(e => e.month))].sort().slice(-6)
  const chartData = allMonths.map(m => ({
    name: monthLabel(m),
    patrimonio: entries.filter(e => e.month === m).reduce((s, e) => s + e.balance, 0),
  }))

  if (loading) return <LoadingScreen />

  return (
    <div style={S.screen}>
      <div style={{ marginBottom: 16 }}>
        <div style={S.label}>Saldo disponível este mês</div>
        <div style={{ ...S.bigVal, color: saldo >= 0 ? '#00E5A0' : '#E24B4A' }}>{fmt(saldo)}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: '#00E5A0' }}>+{fmt(renda)} renda</span>
          <span style={{ fontSize: 12, color: '#E24B4A' }}>-{fmt(totalGasto)} gastos</span>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.label}>Patrimônio total</div>
        <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          {patrimonioAtual > 0 ? fmt(patrimonioAtual) : '—'}
        </div>
        {patrimonioPrev > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: '#1C1D25', borderRadius: 10, padding: 10 }}>
              <div style={S.muted}>Rendimento</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: rendimentoRS >= 0 ? '#00E5A0' : '#E24B4A', marginTop: 2 }}>
                {rendimentoRS >= 0 ? '+' : ''}{fmt(rendimentoRS)}
              </div>
            </div>
            <div style={{ flex: 1, background: '#1C1D25', borderRadius: 10, padding: 10 }}>
              <div style={S.muted}>Variação</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: varPatrimonio >= 0 ? '#00E5A0' : '#E24B4A', marginTop: 2 }}>
                {varPatrimonio >= 0 ? '+' : ''}{varPatrimonio.toFixed(2)}%
              </div>
            </div>
            <div style={{ flex: 1, background: '#1C1D25', borderRadius: 10, padding: 10 }}>
              <div style={S.muted}>Meta 10% a.a.</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#FF9F43', marginTop: 2 }}>{fmt(meta10pct)}</div>
            </div>
          </div>
        )}
        {patrimonioAtual === 0 && (
          <div style={{ ...S.muted, textAlign: 'center', padding: '8px 0' }}>Atualize os saldos na aba Contas</div>
        )}
      </div>

      {chartData.length > 1 && (
        <div style={S.card}>
          <div style={S.label}>Evolução do patrimônio</div>
          <div style={{ height: 160, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="gradPat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4E9EFF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4E9EFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#1C1D25', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12 }}
                  formatter={(value: number) => [fmt(value), 'Patrimônio']} />
                <Area type="monotone" dataKey="patrimonio" stroke="#4E9EFF" strokeWidth={2} fill="url(#gradPat)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {catTotals.length > 0 && (
        <div style={S.card}>
          <div style={S.label}>Gastos do mês</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ width: 120, height: 120, flexShrink: 0 }}>
              <PieChart width={120} height={120}>
                <Pie data={catTotals} cx={55} cy={55} innerRadius={36} outerRadius={54} dataKey="total" paddingAngle={3}>
                  {catTotals.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
              </PieChart>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
              {catTotals.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{c.cat}</div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{fmt(c.total)}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            {catTotals.map((c, i) => {
              const pct = c.budget > 0 ? Math.min((c.total / c.budget) * 100, 100) : 0
              const over = c.budget > 0 && c.total > c.budget
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', width: 80, flexShrink: 0 }}>{c.cat}</div>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: over ? '#E24B4A' : c.color, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11, color: over ? '#E24B4A' : 'rgba(255,255,255,0.4)', width: 65, textAlign: 'right', flexShrink: 0 }}>
                    {fmt(c.total)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={{ ...S.label, marginBottom: 10 }}>Últimos lançamentos</div>
        {txs.slice(0, 5).length === 0
          ? <div style={{ ...S.muted, textAlign: 'center', padding: '12px 0' }}>Nenhum lançamento ainda</div>
          : txs.slice(0, 5).map(t => <TxRow key={t.id} tx={t} />)
        }
      </div>
    </div>
  )
}

function GastosScreen({ uid }: { uid: string }) {
  const [tab, setTab] = useState<'add' | 'list'>('add')
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tipo, setTipo] = useState<'expense' | 'income'>('expense')
  const [valor, setValor] = useState('')
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState<Category>('Conforto')
  const [conta, setConta] = useState(ACCOUNTS[0])
  const [data, setData] = useState(todayStr())
  const [msg, setMsg] = useState('')
  const [filterCat, setFilterCat] = useState('Todos')

  const load = useCallback(async () => {
    const snap = await getDocs(query(collection(db, 'users', uid, 'transactions'), orderBy('createdAt', 'desc')))
    setTxs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
    setLoading(false)
  }, [uid])

  useEffect(() => { load() }, [load])

  const salvar = async () => {
    const v = parseFloat(valor.replace(',', '.'))
    if (!v || v <= 0 || !desc.trim()) { setMsg('Preencha valor e descrição'); return }
    setSaving(true)
    await addDoc(collection(db, 'users', uid, 'transactions'), {
      type: tipo, value: v, description: desc.trim(),
      category: tipo === 'income' ? 'Outros' : cat,
      account: conta, date: data, createdAt: Date.now(),
    })
    setValor(''); setDesc(''); setMsg('Salvo!')
    setTimeout(() => setMsg(''), 2000)
    setSaving(false)
    load()
  }

  const deletar = async (id: string) => {
    await deleteDoc(doc(db, 'users', uid, 'transactions', id))
    load()
  }

  const filtered = filterCat === 'Todos' ? txs : txs.filter(t => t.category === filterCat)

  if (loading) return <LoadingScreen />

  return (
    <div style={S.screen}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
        {(['add', 'list'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14,
            fontWeight: tab === t ? 600 : 400,
            background: tab === t ? '#4E9EFF' : '#13141A',
            color: tab === t ? '#fff' : 'rgba(255,255,255,0.4)',
          }}>
            {t === 'add' ? 'Novo lançamento' : `Histórico (${txs.length})`}
          </button>
        ))}
      </div>

      {tab === 'add' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setTipo('expense')} style={{
              padding: '12px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 500,
              background: tipo === 'expense' ? 'rgba(226,75,74,0.15)' : '#13141A',
              color: tipo === 'expense' ? '#E24B4A' : 'rgba(255,255,255,0.4)',
              border: tipo === 'expense' ? '0.5px solid rgba(226,75,74,0.4)' : '0.5px solid transparent',
            }}>Gasto</button>
            <button onClick={() => setTipo('income')} style={{
              padding: '12px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 500,
              background: tipo === 'income' ? 'rgba(0,229,160,0.1)' : '#13141A',
              color: tipo === 'income' ? '#00E5A0' : 'rgba(255,255,255,0.4)',
              border: tipo === 'income' ? '0.5px solid rgba(0,229,160,0.3)' : '0.5px solid transparent',
            }}>Receita</button>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Valor (R$)</div>
          <input style={S.input} type="number" inputMode="decimal" placeholder="0,00" value={valor} onChange={e => setValor(e.target.value)} />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Descrição</div>
          <input style={S.input} placeholder="Ex: Mercado, Uber..." value={desc} onChange={e => setDesc(e.target.value)} />
          {tipo === 'expense' && (
            <>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Categoria</div>
              <select style={S.select} value={cat} onChange={e => setCat(e.target.value as Category)}>
                {(Object.keys(CATEGORIES) as Category[]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Conta</div>
          <select style={S.select} value={conta} onChange={e => setConta(e.target.value)}>
            {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Data</div>
          <input style={S.input} placeholder="dd/mm/aaaa" value={data} onChange={e => setData(e.target.value)} />
          {msg && <div style={{ textAlign: 'center', fontSize: 13, color: msg === 'Salvo!' ? '#00E5A0' : '#E24B4A', marginBottom: 8 }}>{msg}</div>}
          <button style={{ ...S.btn, opacity: saving ? 0.6 : 1 }} onClick={salvar} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar lançamento'}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4, scrollbarWidth: 'none' }}>
            {['Todos', ...(Object.keys(CATEGORIES) as Category[])].map(c => (
              <button key={c} onClick={() => setFilterCat(c)} style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 12, whiteSpace: 'nowrap',
                background: filterCat === c ? '#4E9EFF' : '#13141A',
                color: filterCat === c ? '#fff' : 'rgba(255,255,255,0.4)',
              }}>{c}</button>
            ))}
          </div>
          {filtered.length === 0
            ? <div style={{ ...S.muted, textAlign: 'center', padding: '40px 0' }}>Nenhum lançamento</div>
            : <div style={S.card}>{filtered.map(t => <TxRow key={t.id} tx={t} onDelete={() => deletar(t.id)} />)}</div>
          }
        </>
      )}
    </div>
  )
}

function ContasScreen({ uid }: { uid: string }) {
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [balances, setBalances] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [accounts, setAccounts] = useState<string[]>(ACCOUNTS)
  const [editNames, setEditNames] = useState<string[]>(ACCOUNTS)
  const [newAccount, setNewAccount] = useState('')
  const mk = currentMonthKey()
  const pmk = prevMonthKey(mk)

  const loadAccounts = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, 'config')))
      const cfg = snap.docs.find(d => d.id === 'accounts')
      if (cfg) {
        const list = cfg.data().list as string[]
        setAccounts(list)
        setEditNames(list)
      }
    } catch {}
  }, [uid])

  const saveAccounts = async (list: string[]) => {
    const snap = await getDocs(query(collection(db, 'users', uid, 'config')))
    const cfg = snap.docs.find(d => d.id === 'accounts')
    if (cfg) await deleteDoc(doc(db, 'users', uid, 'config', cfg.id))
    await addDoc(collection(db, 'users', uid, 'config'), { list, createdAt: Date.now() })
    setAccounts(list)
    setEditNames(list)
  }

  const load = useCallback(async () => {
    const snap = await getDocs(query(collection(db, 'users', uid, 'accountEntries'), orderBy('createdAt', 'desc')))
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as AccountEntry))
    setEntries(data)
    const current = data.filter(e => e.month === mk)
    const init: Record<string, string> = {}
    current.forEach(e => { init[e.account] = String(e.balance) })
    setBalances(init)
  }, [uid, mk])

  useEffect(() => { loadAccounts(); load() }, [loadAccounts, load])

  const salvar = async () => {
    setSaving(true)
    const curr = entries.filter(e => e.month === mk)
    await Promise.all(curr.map(e => deleteDoc(doc(db, 'users', uid, 'accountEntries', e.id))))
    await Promise.all(
      Object.entries(balances)
        .filter(([, v]) => v !== '' && !isNaN(parseFloat(v)))
        .map(([account, v]) => addDoc(collection(db, 'users', uid, 'accountEntries'), {
          account, balance: parseFloat(v.replace(',', '.')), month: mk, createdAt: Date.now(),
        }))
    )
    setMsg('Saldos salvos!')
    setTimeout(() => setMsg(''), 2500)
    setSaving(false)
    load()
  }

  const salvarEdicao = async () => {
    const cleaned = editNames.map(n => n.trim()).filter(n => n.length > 0)
    await saveAccounts(cleaned)
    if (newAccount.trim()) {
      const updated = [...cleaned, newAccount.trim()]
      await saveAccounts(updated)
      setNewAccount('')
    }
    setEditMode(false)
    setMsg('Contas atualizadas!')
    setTimeout(() => setMsg(''), 2000)
  }

  const moverConta = (i: number, dir: 'up' | 'down') => {
    const arr = [...editNames]
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    setEditNames(arr)
  }

  const removerConta = (i: number) => {
    setEditNames(prev => prev.filter((_, idx) => idx !== i))
  }

  const prevEntries = entries.filter(e => e.month === pmk)
  const prevMap: Record<string, number> = {}
  prevEntries.forEach(e => { prevMap[e.account] = e.balance })

  const totalAtual = accounts.reduce((s, a) => s + (parseFloat(balances[a]?.replace(',', '.') || '0') || 0), 0)
  const totalPrev = prevEntries.reduce((s, e) => s + e.balance, 0)
  const diff = totalAtual - totalPrev

  const allMonths = [...new Set(entries.map(e => e.month))].sort().slice(-6)
  const chartData = allMonths.map(m => ({
    name: monthLabel(m),
    total: entries.filter(e => e.month === m).reduce((s, e) => s + e.balance, 0),
  }))

  return (
    <div style={S.screen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ ...S.label, marginBottom: 4 }}>Mês de referência</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{monthLabel(mk)}</div>
        </div>
        <button onClick={() => { setEditMode(!editMode); setEditNames([...accounts]) }} style={{
          background: editMode ? '#4E9EFF22' : '#13141A',
          border: editMode ? '0.5px solid #4E9EFF' : '0.5px solid rgba(255,255,255,0.15)',
          color: editMode ? '#4E9EFF' : 'rgba(255,255,255,0.5)',
          borderRadius: 10, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
        }}>
          {editMode ? 'Cancelar' : 'Editar contas'}
        </button>
      </div>

      {editMode ? (
        <div style={S.card}>
          <div style={{ ...S.label, marginBottom: 12 }}>Editar contas</div>
          {editNames.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => moverConta(i, 'up')} disabled={i === 0} style={{ background: 'none', border: 'none', color: i === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '2px 4px' }}>▲</button>
                <button onClick={() => moverConta(i, 'down')} disabled={i === editNames.length - 1} style={{ background: 'none', border: 'none', color: i === editNames.length - 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '2px 4px' }}>▼</button>
              </div>
              <input
                style={{ ...S.input, marginBottom: 0, flex: 1 }}
                value={name}
                onChange={e => setEditNames(prev => prev.map((n, idx) => idx === i ? e.target.value : n))}
              />
              <button onClick={() => removerConta(i)} style={{ background: 'none', border: 'none', color: '#E24B4A', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
          ))}
          <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)', paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Nova conta</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...S.input, marginBottom: 0, flex: 1 }} placeholder="Nome da conta..." value={newAccount} onChange={e => setNewAccount(e.target.value)} />
            </div>
          </div>
          <button style={{ ...S.btn, marginTop: 14 }} onClick={salvarEdicao}>Salvar alterações</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={S.muted}>Total atual</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{fmt(totalAtual)}</div>
            </div>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={S.muted}>Variação</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: diff >= 0 ? '#00E5A0' : '#E24B4A', marginTop: 4 }}>
                {diff >= 0 ? '+' : ''}{fmt(diff)}
              </div>
            </div>
          </div>
          {chartData.length > 1 && (
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={S.label}>Histórico</div>
              <div style={{ height: 120, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gradCont" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00E5A0" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#00E5A0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background: '#1C1D25', border: 'none', borderRadius: 10, color: '#fff', fontSize: 12 }}
                      formatter={(value: number) => [fmt(value), 'Patrimônio']} />
                    <Area type="monotone" dataKey="total" stroke="#00E5A0" strokeWidth={2} fill="url(#gradCont)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div style={S.card}>
            <div style={S.label}>Saldos de {monthLabel(mk)}</div>
            <div style={{ marginTop: 12 }}>
              {accounts.map(account => {
                const prev = prevMap[account]
                const curr = parseFloat(balances[account]?.replace(',', '.') || '0') || 0
                const delta = prev !== undefined ? curr - prev : null
                return (
                  <div key={account} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{account}</div>
                      {delta !== null && (
                        <div style={{ fontSize: 11, color: delta >= 0 ? '#00E5A0' : '#E24B4A' }}>
                          {delta >= 0 ? '+' : ''}{fmt(delta)}
                        </div>
                      )}
                    </div>
                    <input style={{ ...S.input, marginBottom: 0 }} type="number" inputMode="decimal" placeholder="0,00"
                      value={balances[account] || ''}
                      onChange={e => setBalances(prev => ({ ...prev, [account]: e.target.value }))} />
                    {prev !== undefined && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Mês anterior: {fmt(prev)}</div>}
                  </div>
                )
              })}
            </div>
            {msg && <div style={{ textAlign: 'center', color: '#00E5A0', fontSize: 13, marginBottom: 10 }}>{msg}</div>}
            <button style={{ ...S.btn, opacity: saving ? 0.6 : 1 }} onClick={salvar} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar saldos do mês'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function RelatorioScreen({ uid }: { uid: string }) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [entries, setEntries] = useState<AccountEntry[]>([])
  const [copied, setCopied] = useState(false)
  const mk = currentMonthKey()
  const pmk = prevMonthKey(mk)

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'users', uid, 'transactions'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'users', uid, 'accountEntries'), orderBy('createdAt', 'desc'))),
    ]).then(([txSnap, entSnap]) => {
      setTxs(txSnap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
      setEntries(entSnap.docs.map(d => ({ id: d.id, ...d.data() } as AccountEntry)))
    })
  }, [uid])

  const now = new Date()
  const thisMonthTxs = txs.filter(t => {
    const parts = t.date.split('/')
    return parseInt(parts[1]) === now.getMonth() + 1 && parseInt(parts[2]) === now.getFullYear()
  })

  const totalGasto = thisMonthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.value, 0)
  const totalReceita = thisMonthTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.value, 0)
  const renda = MONTHLY_INCOME + totalReceita
  const patrimonioAtual = entries.filter(e => e.month === mk).reduce((s, e) => s + e.balance, 0)
  const patrimonioPrev = entries.filter(e => e.month === pmk).reduce((s, e) => s + e.balance, 0)
  const rendimento = patrimonioAtual - patrimonioPrev
  const varPct = patrimonioPrev > 0 ? ((rendimento / patrimonioPrev) * 100) : 0
  const meta10 = patrimonioPrev * (10 / 12 / 100)

  const catTotals = (Object.keys(CATEGORIES) as Category[]).map(cat => ({
    cat, total: thisMonthTxs.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.value, 0),
    budget: CATEGORIES[cat].budget,
  })).sort((a, b) => b.total - a.total)

  const top5 = [...thisMonthTxs].filter(t => t.type === 'expense').sort((a, b) => b.value - a.value).slice(0, 5)

  const relatorio = `RELATORIO FINANCEIRO - ${monthLabel(mk)}
Gerado em ${todayStr()}

RENDA E GASTOS DO MES
Renda total: ${fmt(renda)}
Total de gastos: ${fmt(totalGasto)}
Saldo disponivel: ${fmt(renda - totalGasto)}
% gastos sobre renda: ${renda > 0 ? ((totalGasto / renda) * 100).toFixed(1) : 0}%

PATRIMONIO
Patrimonio atual: ${fmt(patrimonioAtual)}
Patrimonio anterior: ${fmt(patrimonioPrev)}
Rendimento: ${fmt(rendimento)} (${varPct.toFixed(2)}%)
Meta 10% a.a. mensal: ${fmt(meta10)}
${rendimento >= meta10 ? 'Acima da meta' : 'Abaixo da meta'}

${entries.filter(e => e.month === mk).map(e => `- ${e.account}: ${fmt(e.balance)}`).join('\n')}

GASTOS POR CATEGORIA
${catTotals.filter(c => c.total > 0).map(c => `${c.cat}: ${fmt(c.total)} / ${fmt(c.budget)} orcado`).join('\n')}

TOP 5 MAIORES GASTOS
${top5.map((t, i) => `${i + 1}. ${t.description} - ${fmt(t.value)} [${t.category}]`).join('\n')}

TODOS OS LANCAMENTOS
${thisMonthTxs.map(t => `${t.type === 'income' ? '+' : '-'} ${fmt(t.value)} | ${t.description} | ${t.category} | ${t.date}`).join('\n')}
`

  const copiar = () => {
    navigator.clipboard.writeText(relatorio).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div style={S.screen}>
      <div style={S.label}>Relatório do mês</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>{monthLabel(mk)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div style={{ ...S.card, marginBottom: 0 }}>
          <div style={S.muted}>Patrimônio</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{fmt(patrimonioAtual)}</div>
          <div style={{ fontSize: 11, color: rendimento >= 0 ? '#00E5A0' : '#E24B4A', marginTop: 2 }}>
            {rendimento >= 0 ? '+' : ''}{fmt(rendimento)}
          </div>
        </div>
        <div style={{ ...S.card, marginBottom: 0 }}>
          <div style={S.muted}>Vs meta 10%</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{fmt(meta10)}</div>
          <div style={{ fontSize: 11, color: rendimento >= meta10 ? '#00E5A0' : '#FF9F43', marginTop: 2 }}>
            {rendimento >= meta10 ? 'No ritmo' : 'Abaixo'}
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ ...S.label, marginBottom: 10 }}>Preview — texto para IA</div>
        <div style={{
          background: '#0D0E14', borderRadius: 10, padding: 12,
          fontFamily: "'DM Mono', monospace", fontSize: 10.5,
          color: 'rgba(255,255,255,0.6)', lineHeight: 1.7,
          maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap',
        }}>{relatorio}</div>
        <button style={{ ...S.btn, marginTop: 12, background: copied ? '#00E5A0' : '#4E9EFF' }} onClick={copiar}>
          {copied ? 'Copiado!' : 'Copiar relatório'}
        </button>
        <div style={{ ...S.muted, textAlign: 'center', fontSize: 11, marginTop: 8 }}>
          Cole no ChatGPT ou Claude para análise
        </div>
      </div>
    </div>
  )
}

function TxRow({ tx, onDelete }: { tx: Transaction; onDelete?: () => void }) {
  const isInc = tx.type === 'income'
  const color = isInc ? '#00E5A0' : (CATEGORIES[tx.category as Category]?.color || '#888')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{tx.category} · {tx.account} · {tx.date}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: isInc ? '#00E5A0' : '#E24B4A', whiteSpace: 'nowrap' }}>
        {isInc ? '+' : '-'}{fmt(tx.value)}
      </div>
      {onDelete && (
        <button onClick={onDelete} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 18, padding: '0 2px' }}>x</button>
      )}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #4E9EFF', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const NavIcon = ({ type }: { type: string }) => {
  const icons: Record<string, string> = {
    painel: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    gastos: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    contas: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
    relatorio: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d={icons[type]} />
    </svg>
  )
}

type Screen = 'painel' | 'gastos' | 'contas' | 'relatorio'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>('painel')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  if (authLoading) {
    return <div style={{ height: '100vh', background: '#0A0B0F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LoadingScreen /></div>
  }

  if (!user) {
    return <div style={{ height: '100vh', background: '#0A0B0F' }}><LoginScreen /></div>
  }

  const navItems: { key: Screen; label: string }[] = [
    { key: 'painel', label: 'Painel' },
    { key: 'gastos', label: 'Gastos' },
    { key: 'contas', label: 'Contas' },
    { key: 'relatorio', label: 'Relatório' },
  ]

  return (
    <div style={{ height: '100vh', background: '#0A0B0F', display: 'flex', justifyContent: 'center' }}>
      <div style={S.app}>
        {screen === 'painel' && <PainelScreen uid={user.uid} />}
        {screen === 'gastos' && <GastosScreen uid={user.uid} />}
        {screen === 'contas' && <ContasScreen uid={user.uid} />}
        {screen === 'relatorio' && <RelatorioScreen uid={user.uid} />}
        <nav style={S.nav}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setScreen(item.key)} style={{
              ...S.navBtn,
              color: screen === item.key ? '#4E9EFF' : 'rgba(255,255,255,0.3)',
            }}>
              <NavIcon type={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button onClick={() => signOut(auth)} style={{
          position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.2)', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
        }}>sair</button>
      </div>
    </div>
  )
}
