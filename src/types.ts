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
  month: string
  createdAt: number
}

export const ACCOUNTS = [
  'Bradesco', 'Nubank', 'Nubank PJ', 'Reserva',
  'Banco Inter', 'Renda Fixa', 'Renda Variavel', 'Forex', 'Outros',
]

export const CATEGORIES = {
  Investimentos: { color: '#00E5A0', budget: 0 },
  'Custos Fixos': { color: '#4E9EFF', budget: 0 },
  Conforto: { color: '#B97FFF', budget: 0 },
  Metas: { color: '#FF9F43', budget: 0 },
  Outros: { color: '#888780', budget: 0 },
}

export const MONTHLY_INCOME = 0
