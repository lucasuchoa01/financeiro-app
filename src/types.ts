export type Category = 'Investimentos' | 'Custos Fixos' | 'Conforto' | 'Metas' | 'Outros'
export type TxType = 'expense' | 'income'

export interface Transaction {
  id: string
  type: TxType
  value: number
  description: string
  category: Category
  account: string
  date: string
  createdAt: number
}

export interface AccountEntry {
  id: string
  account: string
  balance: number
  month: string // 'YYYY-MM'
  createdAt: number
}

export interface Budget {
  category: Category
  limit: number
}

export const ACCOUNTS = [
  'Bradesco',
  'Nubank',
  'Nubank PJ',
  'Reserva',
  'Banco Inter',
  'Renda Fixa',
  'Renda Variável',
  'Forex',
  'Outros',
]

export const CATEGORIES: Record<Category, { color: string; budget: number }> = {
  Investimentos: { color: '#00E5A0', budget: 2800 },
  'Custos Fixos': { color: '#4E9EFF', budget: 2655 },
  Conforto: { color: '#B97FFF', budget: 1895 },
  Metas: { color: '#FF9F43', budget: 1400 },
  Outros: { color: '#888780', budget: 0 },
}

export const MONTHLY_INCOME = 8000
