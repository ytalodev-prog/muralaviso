# Mural — Central de avisos

Site responsivo para publicar avisos e recebê-los em uma conta dedicada à portaria.

## Requisitos

- Node.js 20 ou superior
- Nenhuma dependência externa

## Executar localmente

```bash
npm start
```

Abra `http://localhost:3000`. Os dados locais ficam em `data/store.json` e não são sincronizados com a versão publicada.

## Publicar na Vercel

O frontend é servido como arquivo estático e as rotas em `api/` são funções serverless. Para persistir contas e avisos entre execuções, a versão publicada usa Supabase; o arquivo local não é usado na Vercel. O servidor local `server.js` é excluído do deploy para a Vercel não tentar executá-lo como entrada serverless.

1. Crie um projeto no Supabase e execute [`supabase/schema.sql`](./supabase/schema.sql) no SQL Editor.
2. Importe este projeto na Vercel usando **Other** como framework. O `vercel.json` já configura esse preset e a pasta `public` como saída; as funções em `api/` são detectadas automaticamente. Não é necessário configurar comando de build ou dependências adicionais.
3. Adicione estas variáveis em **Project Settings → Environment Variables**:
   - `SUPABASE_URL`: URL do projeto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role` do Supabase. Mantenha-a apenas na Vercel; nunca a coloque no frontend.
   - `SESSION_SECRET`: segredo aleatório de pelo menos 32 caracteres. Gere um com `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
4. Faça o deploy e abra o domínio publicado. No primeiro acesso, crie a conta publicadora. A conta da portaria é criada automaticamente.

O setup inicial é atômico e só pode ser realizado uma vez por banco. Se precisar reiniciar o cadastro, limpe as contas no banco com cuidado antes de fazê-lo.

## Contas e segurança

- **Publicador:** entra com o e-mail e a senha cadastrados; pode publicar e consultar avisos.
- **Portaria:** usuário `Portaria`, senha `Portaria@123`; pode apenas consultar avisos.
- Senhas são armazenadas com hash scrypt. Sessões assinadas são protegidas por cookie `HttpOnly`, `Secure` e `SameSite=Strict`, com validade de 12 horas.
