# AWS Budgets — Zeus Builder (~US$100/mês)

## Situação (verificado 2026-09-14)
A identidade atual do gateway/scripts é o IAM user **`zeus-ai-storage`** (conta `680191162788`).
Ela **NÃO tem permissão** de AWS Budgets:
- `budgets:ViewBudget` → AccessDenied (describe-budgets)
- `budgets:ModifyBudget` → AccessDenied (create-budget)

Portanto o AWS Budget **não pôde ser criado via CLI** nesta sessão. É uma ação administrativa
na conta AWS. Abaixo está tudo pronto para um admin executar.

> Defesa em profundidade: o Zeus Builder JÁ tem um **budget guard em app** (por tenant,
> `ZEUS_TENANT_BUDGET_USD`, default 100) que bloqueia novos builds ao estourar o teto no mês.
> O AWS Budget abaixo é a rede de segurança no nível da CONTA (cobrança real).

## 1) Política IAM necessária (anexar ao usuário/role que vai gerenciar o budget)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["budgets:ViewBudget", "budgets:ModifyBudget"],
      "Resource": "arn:aws:budgets::680191162788:budget/*"
    }
  ]
}
```

## 2) Criar o budget mensal de US$100 com alertas (80% e 100%)
Crie `budget.json`:
```json
{
  "BudgetName": "zeus-builder-monthly",
  "BudgetLimit": { "Amount": "100", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
```
E `notifications.json` (troque o e-mail):
```json
[
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 80, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "seu-email@exemplo.com" } ]
  },
  {
    "Notification": { "NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": 100, "ThresholdType": "PERCENTAGE" },
    "Subscribers": [ { "SubscriptionType": "EMAIL", "Address": "seu-email@exemplo.com" } ]
  }
]
```
Comando:
```bash
aws budgets create-budget \
  --account-id 680191162788 \
  --budget file://budget.json \
  --notifications-with-subscribers file://notifications.json
```

## 3) (Opcional) Filtrar só o custo do Bedrock
Para orçar apenas o gasto de LLM, adicione ao `budget.json` um `CostFilters` por serviço:
```json
"CostFilters": { "Service": ["Amazon Bedrock"] }
```

## 4) Verificar
```bash
aws budgets describe-budgets --account-id 680191162788
```
