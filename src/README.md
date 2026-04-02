# 💰 Financeiro Pessoal

App pessoal de finanças — React + TypeScript + Firebase + Vercel.

## Stack
- React 18 + TypeScript
- Vite
- Firebase (Auth + Firestore)
- Recharts (gráficos)
- Deploy: Vercel

## Como configurar

### 1. Firebase
1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um novo projeto (ex: `financeiro-pessoal`)
3. Adicione um app Web
4. Ative **Authentication → Email/Senha**
5. Ative **Firestore Database** (modo produção)
6. Copie as credenciais do app web

### 2. Variáveis de ambiente
Crie um arquivo `.env` na raiz com as credenciais:

```env
VITE_FIREBASE_API_KEY=sua_api_key
VITE_FIREBASE_AUTH_DOMAIN=seu_projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu_projeto
VITE_FIREBASE_STORAGE_BUCKET=seu_projeto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=seu_sender_id
VITE_FIREBASE_APP_ID=seu_app_id
```

### 3. Regras do Firestore
No console do Firebase → Firestore → Regras, cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 4. Rodar localmente
```bash
npm install
npm run dev
```

### 5. Deploy no Vercel
1. Suba o projeto no GitHub
2. Importe no Vercel
3. Adicione as variáveis de ambiente no painel do Vercel
4. Deploy automático!

## Estrutura do Firestore
```
users/
  {uid}/
    transactions/     ← gastos e receitas
    accountEntries/   ← saldos mensais por conta
```

## Personalizar
Edite `src/types.ts` para ajustar:
- `ACCOUNTS` — suas contas
- `CATEGORIES` — categorias e orçamentos
- `MONTHLY_INCOME` — sua renda mensal
