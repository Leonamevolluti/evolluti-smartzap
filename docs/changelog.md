# Changelog (docs)

## 16/01/2026 - Editor unificado (“Tela Viva”)

- **🧠 Um único editor (sem “modo Formulário vs Dinâmico”)**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` agora usa apenas `UnifiedFlowEditor` e removeu o toggle de modos
  - Preview continua como “verdade” e passa a suportar **seleção** (highlight) para editar via painel contextual

- **📦 Modelo canônico em `DynamicFlowSpecV1` (migração automática)**
  - `lib/dynamic-flow.ts` ganhou conversores `formSpecToDynamicSpec` e `bookingConfigToDynamicSpec`
  - `UnifiedFlowEditor` persiste `spec.dynamicFlow` em background quando o flow vem de `spec.form`, `spec.booking` ou `flow_json` legado

- **🧭 Geração de Flow JSON mais “Meta-like”**
  - `lib/dynamic-flow.ts` agora gera navegação com `navigate.next` como padrão
  - `data_api_version: "3.0"` e `routing_model` só entram quando existe `data_exchange` (sem expor routing em flows “form-like”)
  - Injeção de chaves `__editor_key`/`__editor_title_key` para seleção/edição no preview (formato `screen:*`)

- **🧩 Painel contextual + Assistente de Agendamento**
  - `components/features/flows/builder/InspectorPanel.tsx` edita título/texto/pergunta/CTA do elemento selecionado
  - Assistente de agendamento permite ajustar **serviços** e alternar **Calendário vs Dropdown** sem telas separadas

- **🧹 Limpeza e robustez no publish**
  - `app/api/flows/[id]/meta/publish/route.ts` removeu logs internos e evita validar `spec.form` quando o Flow é dinâmico

- **✅ Regras de navegação mais “óbvias”**
  - Telas com próxima etapa não podem ficar como “Tela final”; o CTA vira **Continuar** automaticamente

- **🧭 Caminhos (Mapa do fluxo) — ramificação sem JSON**
  - `lib/dynamic-flow.ts` ganhou `defaultNextByScreen` e `branchesByScreen` no `DynamicFlowSpecV1` + validações
  - `generateDynamicFlowJson` inclui `routing_model` automaticamente quando houver ramificações (mesmo sem `data_exchange`)
  - `components/features/flows/builder/UnifiedFlowEditor.tsx` adiciona seção **Caminhos** com destino padrão + regras por campo
  - `components/ui/MetaFlowPreview.tsx` simula ramificação no clique do CTA usando os “Caminhos” do editor (sem expor JSON)
  - `components/features/flows/builder/dynamic-flow/AdvancedFlowPanel.tsx` vira modo de manutenção (remove edição de routing JSON)

- **📡 Publish na Meta: compatibilidade com `routing_model`**
  - `lib/dynamic-flow.ts` normaliza IDs de telas para o padrão aceito pela Meta no `routing_model` (somente letras/underscore), migrando `SCREEN_1/2/3...` → `SCREEN_A/B/C...`
  - `app/api/flows/[id]/meta/publish/route.ts` passa a exigir `endpoint_uri` também quando houver `data_api_version: "3.0"`/`routing_model` (mesmo sem `data_exchange`), com mensagem explícita de que **localhost não publica**

## 15/01/2026 - Builder dinâmico estilo “Formulário”

- **🧱 Novo builder dinâmico com UX de formulário**
  - `components/features/flows/builder/dynamic-flow/DynamicFlowBuilder.tsx` traz abas por tela + lista de “blocos” com mover/duplicar/excluir
  - CTA virou editor simples: **texto do botão**, **tipo de ação** e **“Ir para (próxima tela)”** (sem expor JSON)

- **🧭 Integração no editor principal**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` usa o `DynamicFlowBuilder` quando o modo for **Dinâmico** (para templates não-agendamento)
  - Alternar **Formulário/Dinâmico** também sincroniza a prévia (evita precisar “sair e entrar”)
  - Alternar **“Fluxo real / Formulário”** na prévia também troca o editor (evita confusão e garante atualização imediata)
  - Simplificação: removidos botões “Fluxo real / Formulário” da prévia (a fonte agora segue o modo do editor)
  - Simplificação: removidos botões/indicadores de prévia; a área mostra apenas o preview **Meta (oficial)**, sempre
  - Simplificação: ações do builder (salvar/telas/avançado) foram movidas para um menu “⋯” com **auto-salvar**

- **🧩 JSON mais parecido com o Flow Builder da Meta**
  - `lib/dynamic-flow.ts` agora prefere aplicar o `Footer` dentro do primeiro `Form` (quando existir)
  - Extração de ação do `Footer` ficou recursiva (funciona mesmo com `Footer` aninhado)

## 15/01/2026 - Formulário com múltiplas telas (etapas)

- **🧩 Form builder agora suporta etapas**
  - `lib/flow-form.ts` ganhou `steps` (retrocompatível) e gera `screens[]` com `navigate.next` entre etapas e `complete` no final
  - Validação agora considera limite de \(50\) componentes **por etapa** e nomes únicos entre etapas

- **🧭 UI de etapas no modo Formulário**
  - `components/features/flows/builder/FlowFormBuilder.tsx` adiciona abas de **Etapas** + menu “⋯” para adicionar/remover etapa
  - Cada etapa tem **título** e botão “Continuar” configurável (a última usa “Enviar”)

- **📱 Preview suporta navegação oficial**
  - `components/ui/MetaFlowPreview.tsx` agora entende `on-click-action.next.name` (além do fallback antigo via `payload.screen`)

## 15/01/2026 - Wizard de agendamento

- **🧭 UI simplificada no editor de agendamento**
  - `components/features/flows/builder/dynamic-flow/BookingDynamicEditor.tsx` agora usa wizard com 4 passos
  - Oculta o routing model por padrao e exibe em "Avancado"

- **📱 Preview dinâmico com dados reais**
  - `components/ui/MetaFlowPreview.tsx` resolve bindings `${data.*}` usando `__example__`
  - Melhora a leitura da tela inicial no modo dinâmico

- **🖱️ Edicao rapida direto no preview**
  - `lib/dynamic-flow.ts` adiciona chaves de editor no JSON de agendamento
  - `components/ui/MetaFlowPreview.tsx` permite clicar nos textos para editar

- **🧊 Modo minimalista no editor**
  - `components/features/flows/builder/dynamic-flow/BookingDynamicEditor.tsx` agora mostra apenas o botao "Editar textos"
  - Configuracoes de servicos/data e routing ficam em "Avancado"

- **🪟 Editor inline sem prompt**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` usa modal nativo do app para editar textos
  - Evita erro de `prompt()` no ambiente do app

- **🧹 Preview e avancado alinhados**
  - `components/ui/MetaFlowPreview.tsx` agora reflete servicos do agendamento corretamente
  - `components/features/flows/builder/dynamic-flow/BookingDynamicEditor.tsx` remove routing model do modo simples

## 15/01/2026 - Ajuste de CTA no preview

- **✅ CTA respeita campos obrigatorios**
  - `components/ui/MetaFlowPreview.tsx` volta a bloquear o botao ate preencher

- **🧼 Agendamento sem modo tecnico**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` oculta o editor tecnico no template de agendamento
  - Mantem apenas o painel simples + preview clicavel

- **🔗 Painel acompanha o preview**
  - `components/features/flows/builder/dynamic-flow/BookingDynamicEditor.tsx` mostra campos da tela atual
  - `components/ui/MetaFlowPreview.tsx` notifica a tela ativa no preview

- **🖼️ Preview sempre visivel no modo dinamico**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` mostra o preview mesmo sem perguntas do formulario

- **👀 Preview forçado no agendamento**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` mantém preview dinâmico sempre ativo no template de agendamento

## 15/01/2026 - Spec dinâmico e geração dedicada

- **🧩 Spec V1 para flows dinâmicos**
  - `lib/dynamic-flow.ts` adiciona `DynamicFlowSpecV1`, normalização e geração de JSON dinâmico
  - Garante ações por tela (data_exchange/navigate/complete) preservando payload e CTA

- **🧭 Builder salva spec e regenera JSON**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` passa a persistir o spec dinâmico e gerar o JSON no preview/salvamento
  - Mantém compatibilidade com flows dinâmicos legados salvos como `flowJson`

- **🚀 Publish usa spec dinâmico atualizado**
  - `app/api/flows/[id]/meta/publish/route.ts` gera o JSON a partir do spec dinâmico quando disponível
  - Continua priorizando o config de agendamento para o template `agendamento_dinamico_v1`

## 15/01/2026 - UX redesign completo (Progressive Disclosure)

- **✨ Preview editável inline**
  - Clique direto no preview para editar títulos, subtítulos, labels e botões
  - `components/ui/MetaFlowPreview.tsx` resolve `${data.*}` e permite edição inline
  - `components/ui/InlineEditableText.tsx` para edição contentEditable com hover states

- **🎯 Menu de contexto**
  - Botão direito no preview para ações rápidas (editar texto)
  - `components/ui/ContextMenu.tsx` com design minimalista
  - Preparado para adicionar/remover/duplicar campos no futuro

- **🔧 Modo Avançado (Progressive Disclosure)**
  - Botão discreto "Modo Avançado →" só aparece quando necessário
  - `components/features/flows/builder/dynamic-flow/AdvancedFlowPanel.tsx` painel lateral para telas/routing
  - Interface simples por padrão, complexidade escondida até ser necessária

- **📱 Preview sempre visível**
  - Preview dinâmico aparece automaticamente (sem exigir perguntas)
  - Botão verde só habilita quando campos obrigatórios preenchidos
  - Navegação entre telas funciona como app real

- **🧹 Cleanup de UI confusa**
  - `BookingDynamicEditor` agora tem apenas "Edição rápida" + "Configurações" colapsável
  - Removido wizard com 4 passos (era redundante com preview)
  - Removido "Tela atual" que duplicava informação

- **🧩 Spec dinâmico V1**
  - `lib/dynamic-flow.ts`: `DynamicFlowSpecV1`, normalização, validação e geração de JSON
  - `generateDynamicFlowJson()` para flows genéricos
  - `dynamicFlowSpecFromJson()` para converter JSON existente em spec

- **🚀 Publish usa spec dinâmico**
  - `app/api/flows/[id]/meta/publish/route.ts` prioriza `spec.dynamicFlow` e `spec.booking`
  - Mantém compatibilidade com flows legados

## 15/01/2026 - MiniApps dinâmicos (agendamento)

- **🔐 Health check (ping) agora retorna resposta CRIPTOGRAFADA**
  - `app/api/flows/endpoint/route.ts` corrigido para criptografar resposta do ping
  - Segundo documentação oficial da Meta, TODAS as respostas devem ser criptografadas
  - Isso estava causando erro "Endpoint Not Available" na publicação

- **📚 Documentação consolidada de WhatsApp Flows**
  - Criado `docs/whatsapp-flows-complete-reference.md` com toda a documentação oficial
  - Inclui checklist de implementação, códigos de erro, e exemplos de código

- **🐛 Fix: Parser da chave pública da Meta**
  - `lib/meta-flows-api.ts` agora lê corretamente `data.data[0]` em vez de `data` direto
  - A Meta retorna `{ data: [{ business_public_key, ... }] }` e não `{ business_public_key }`

- **✅ Publicação preserva Flow JSON dinâmico**
  - `app/api/flows/[id]/meta/publish/route.ts` agora mantém o `flow_json` salvo quando `data_api_version=3.0`
  - Evita regenerar a partir do `spec.form` e perder `data_exchange` no agendamento com Google Calendar

- **🧭 Builder não sobrescreve Flow dinâmico**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` mantém `flow_json` dinâmico ao salvar/publicar
  - Garante que o template de agendamento continue com `data_exchange` após ajustes no formulário

- **🧩 Validação local aceita componente Form**
  - `lib/meta-flow-json-validator.ts` agora permite `Form` e valida filhos internos
  - Desbloqueia publish de MiniApps dinâmicos com `data_exchange`

- **🔗 Endpoint URL resolvido para MiniApps dinâmicos**
  - `app/api/flows/endpoint/keys/route.ts` passa a usar origin dos headers e salvar URL no settings
  - `app/api/flows/[id]/meta/publish/route.ts` utiliza URL salva quando envs não estão setadas

- **🧰 Endpoint keys com runtime Node e sem cache**
  - `app/api/flows/endpoint/keys/route.ts` força `nodejs` + `force-dynamic`
  - Evita resposta stale e garante headers disponíveis para montar URL

- **🛰️ Endpoint URL sem cache no painel**
  - `components/features/settings/FlowEndpointPanel.tsx` força `no-store`
  - `app/api/flows/endpoint/keys/route.ts` retorna `Cache-Control: no-store`

- **🧯 Evita sobrescrever URL com localhost**
  - `app/api/flows/endpoint/keys/route.ts` não grava URL local no settings
  - Prioriza URL salva/ambiente quando o request não é localhost

- **🧪 Debug de origem do endpoint**
  - `app/api/flows/endpoint/keys/route.ts` expõe origem da URL para diagnóstico
  - `components/features/settings/FlowEndpointPanel.tsx` loga `header/env/stored`

- **🧾 Debug seguro do publish**
  - `app/api/flows/[id]/meta/publish/route.ts` retorna detalhes da Meta com `x-debug-client=1`
  - `services/flowsService.ts` envia o header e registra o erro localmente

- **🔧 Build corrigido no publish**
  - Ajuste de escopo em `app/api/flows/[id]/meta/publish/route.ts` para `wantsDebug`

- **🏷️ Nome único ao publicar Flow**
  - `app/api/flows/[id]/meta/publish/route.ts` adiciona sufixo com ID para evitar colisão na Meta

- **🧾 Erro da Meta exibido no publish**
  - `services/flowsService.ts` agora expõe `error_user_title` e `error_user_msg` quando disponíveis

- **🔐 Registro automático da chave pública**
  - `app/api/flows/[id]/meta/publish/route.ts` agora registra a chave pública na Meta antes de publicar flows dinâmicos

- **📞 Registro de chave usa Phone Number ID**
  - `lib/meta-flows-api.ts` agora usa `phone_number_id` no endpoint `whatsapp_business_encryption`

- **🧾 Registro de chave com form-url-encoded**
  - `lib/meta-flows-api.ts` envia `business_public_key` como `application/x-www-form-urlencoded`, conforme documentação da Meta

- **✅ Endpoint reconhece notificações de erro**
  - `lib/whatsapp/flow-endpoint-handlers.ts` responde `{ data: { acknowledged: true } }` quando recebe `data.error` do client

- **🏷️ Retry automático em nome não único**
  - `app/api/flows/[id]/meta/publish/route.ts` tenta um nome alternativo quando a Meta retorna erro 4016019

- **🔍 Debug avançado de chave pública**
  - `app/api/flows/[id]/meta/publish/route.ts` agora expõe hash da chave local/meta e status de assinatura

- **🧯 Bloqueio quando chave não registra**
  - `app/api/flows/[id]/meta/publish/route.ts` interrompe o publish se a chave não persistir na Meta

## 15/01/2026 - Agendamento (Settings + Flow)

- **🧾 Persistência de regras de agendamento**
  - `app/api/settings/calendar-booking/route.ts` agora salva e normaliza `minAdvanceHours`, `maxAdvanceDays`, `allowSimultaneous` e `slots`
  - Garante que a UI e o Flow usem as regras corretas

- **📅 Datas do Flow em formato simples**
  - `lib/whatsapp/flow-endpoint-handlers.ts` passa a fornecer datas no formato `DD/MM/YYYY`
  - Mantém `id` em `YYYY-MM-DD` para compatibilidade interna

- **🗓️ CalendarPicker no Flow de agendamento**
  - `scripts/test-booking-flow.mjs` troca dropdown por `CalendarPicker` (calendário visual)
  - Flow JSON atualizado para `7.3` (recomendado pela Meta) e campos `min/max/include-days`
  - Datas não trabalhadas agora aparecem desabilitadas via `unavailable-dates`

- **🗓️ Data com dia da semana no Flow**
  - `lib/whatsapp/flow-endpoint-handlers.ts` exibe `DD/MM/YYYY (Quinta)` no título da seleção de horários
  - Mensagem de erro também destaca a data como `Quinta - 22/01`

- **🌐 Webhook externo para agendamentos**
  - `app/api/settings/calendar-booking/route.ts` passa a salvar `externalWebhookUrl` no config
  - `components/features/settings/calendar/BookingConfigSection.tsx` adiciona campo para URL externa
  - `app/api/webhook/route.ts` envia payload JSON para o webhook no `nfm_reply`

- **✅ Confirmação detalhada no WhatsApp**
  - `app/api/webhook/route.ts` inclui nome, telefone e observações na mensagem de confirmação
  - Data exibida com dia da semana quando disponível
  - `lib/whatsapp/flow-endpoint-handlers.ts` inclui dados do formulário no close response para o webhook

- **🧾 Confirmação configurável no Form Builder**
  - `lib/flow-form.ts` adiciona `sendConfirmation` e envia `send_confirmation` no payload quando desativado
  - `components/features/flows/builder/FlowFormBuilder.tsx` inclui toggle "Enviar confirmação ao usuário"
  - `app/api/webhook/route.ts` respeita `send_confirmation` e gera resumo genérico quando aplicável
  - `lib/flow-form.ts` permite definir `confirmation_title` e `confirmation_footer` por Flow

- **✍️ Mensagem de confirmação personalizável**
  - `components/features/settings/calendar/BookingConfigSection.tsx` permite editar título e rodapé
  - `app/api/webhook/route.ts` usa os textos configurados para a confirmação

- **✅ Confirmação automática pós‑Flow**
  - `app/api/webhook/route.ts` envia mensagem de confirmação quando recebe `nfm_reply` do Flow
  - Mensagem inclui serviço, data e horário quando disponíveis

## 15/01/2026 - Campanhas

- **🧩 Clone de campanha usa rota correta**
  - `services/campaignService.ts` agora chama `/api/campaigns/:id/clone` (em vez de `/duplicate`)
  - `services/campaignService.test.ts` atualizado para refletir a rota

## 15/01/2026 - Flow Builder

- **👀 Preview do template dinâmico de agendamento**
  - `components/ui/MetaFlowPreview.tsx` passa a renderizar componentes dentro de `Form`
  - Corrige preview vazio ao selecionar "Agendamento (Google Calendar)"

- **🧭 Preview alinhado ao editor**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` usa o form spec no preview
  - Evita mostrar a tela dinâmica (BOOKING_START) quando o usuário edita as perguntas

- **🔀 Alternância de prévia (dinâmico vs formulário)**
  - `app/(dashboard)/flows/builder/[id]/page.tsx` permite alternar entre "Fluxo real" e "Formulário"
  - Ajuda a comparar o passo inicial do agendamento com os campos finais

- **🧪 Simulação local no preview Meta**
  - `components/ui/MetaFlowPreview.tsx` agora permite navegar entre telas via routing_model
  - CTA avança e o botão de fechar volta quando existe histórico

## 25/12/2025 - Debug (Run/Trace para campanhas)

- **🔎 Timeline estruturada por `trace_id` (sem caçar logs)**
  - Nova migration: `supabase/migrations/0026_add_campaign_trace_events.sql` cria `campaign_trace_events`
  - Eventos relevantes do workflow/webhook passam a ser persistidos (best-effort) para inspeção no Supabase
  - Persistência é filtrada para evitar alto volume (erros + fases-chave como `batch_start`/`batch_end`/`complete`)

- **🧷 Correlação ponta-a-ponta (precheck → workflow → webhook)**
  - `traceId` agora é gerado cedo no `dispatch` e gravado em `campaign_contacts` já no precheck (pending/skipped)
  - Webhook emite eventos “positivos” (`delivered`/`read`) na timeline quando o update é aplicado

- **🖥️ Interface de Debug (Trace View) na tela de campanha**
  - Adicionado painel “Debug • Execuções (Trace)” nos detalhes da campanha para listar `trace_id` e navegar na timeline (`campaign_trace_events`)
  - Endpoints novos: `GET /api/campaigns/:id/trace` e `GET /api/campaigns/:id/trace-events`
  - O painel agora **auto-seleciona o último run automaticamente** (sem precisar clicar em `trace_id`), com fallback via métricas quando disponível

## 25/12/2025 - Segurança (Sentinel)

- **🛡️ Hardening de headers HTTP (Next.js)**
  - Adicionados headers defensivos (ex: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`)
  - `Strict-Transport-Security` habilitado somente em produção
  - Desativado `X-Powered-By` para reduzir fingerprinting

- **🔒 Proteção de endpoint sensível de setup**
  - `GET /api/setup/auto-migrate` agora exige `SMARTZAP_ADMIN_KEY` (ou `SMARTZAP_API_KEY`) via `Authorization: Bearer ...` ou `?key=...`
  - Detalhes de erro agora são omitidos em produção para reduzir vazamento de informações

- **🧱 Blindagem pós-instalação + logs só em dev**
  - `POST /api/setup/migrate` agora é **desativado** quando `SETUP_COMPLETE=true` (evita uso após instalação)
  - `console.log` em rotas de setup/auth passam a rodar somente fora de produção (reduz ruído e risco de info leak)

- **🚨 Proteção crítica de PII (defesa em profundidade)**
  - Rotas `app/api/contacts/**` agora exigem **sessão válida** ou **API key** (`Authorization: Bearer ...`)

- **🔐 Webhook Meta (anti-spoof)**
  - `POST /api/webhook` valida `X-Hub-Signature-256` quando `META_APP_SECRET` está configurado (modo compatível: sem secret não bloqueia)

## 25/12/2025 - Parte 4 (Polish Final)

- **✨ Refinamento de Focus States**
  - Substituído `outline` por `ring` para focus indicators mais elegantes
  - Adicionado `ring-offset` para melhor separação visual
  - Usado opacidade (`/50`) para sutileza
  - Ajustado `ring-offset-color` para combinar com fundo escuro
  
  **Mudança Visual:**
  - Antes: Contorno grosso e mal posicionado
  - Depois: Ring fino, elegante e bem posicionado
  - Resultado: Focus state mais profissional e menos intrusivo

## 25/12/2025 - Parte 3 (Padronização Completa)

- **🎯 Padronização Total do Sistema**
  - Auditoria completa de **TODOS** os componentes principais
  - Adicionados **Tooltips** em ContactListView (editar, excluir, paginação)
  - Padronizados **Hover effects** em todas as tabelas (glow verde + 200ms)
  - Verificados **Focus states** em todos os botões interativos
  - Confirmado **Loading states** consistentes em todo o sistema
  
  **Componentes Auditados e Padronizados:**
  - ✅ CampaignListView: 100% padronizado
  - ✅ ContactListView: 100% padronizado
  - ✅ TemplateListView: 100% padronizado
  - ✅ DashboardView: 100% padronizado
  - ✅ DashboardShell: 100% padronizado
  - ✅ SettingsView: 100% padronizado
  
  **Padrões Garantidos:**
  - 🎯 Tooltips em TODOS os botões icon-only
  - ✨ Hover effects consistentes (shadow + glow)
  - ⏱️ Transições uniformes (200ms)
  - 🎨 Focus-visible em TODOS os elementos interativos
  - 🔄 Loading skeletons com animação escalonada

## 25/12/2025 - Parte 2

- **✨ Melhorias Visuais e Interativas (Opção C)**
  - Adicionados **Tooltips** em todos os botões icon-only (hover para ver descrição)
  - Criado componente **ConfirmationDialog** reutilizável para ações destrutivas
  - Melhorados **Loading Skeletons** com animações escalonadas (staggered)
  - Adicionados **Hover Effects** com glow sutil em cards e linhas de tabela
  - Melhoradas **transições** de 200ms para interações mais suaves
  
  **Componentes com melhorias visuais:**
  - ✨ CampaignListView: Tooltips em todos os botões de ação
  - ✨ DashboardView: Hover effects e loading skeletons melhorados
  - ✨ ConfirmationDialog: Novo componente para confirmações
  
  **Impacto Visual:**
  - 🎯 Tooltips aparecem ao passar o mouse (300ms delay)
  - ✨ Glow sutil verde ao passar sobre linhas de tabela
  - 🔄 Loading skeletons com animação em cascata
  - 🎨 Transições suaves em todas as interações

## 25/12/2025 - Parte 1

- **🎨 Melhorias de UX e Acessibilidade (100+ micro-melhorias)**
  - Adicionados **ARIA labels** em todos os botões icon-only para melhor acessibilidade com leitores de tela
  - Implementados **estilos focus-visible** consistentes em toda a aplicação para navegação por teclado
  - Melhorado **estado vazio** em CampaignListView com mensagens contextuais e orientações
  - Adicionados **aria-live** regions para feedback dinâmico (paginação, contadores)
  - Implementado **aria-current** em navegação e paginação para indicar página/item ativo
  - Adicionados **aria-hidden** em ícones decorativos para evitar poluição em leitores de tela
  - Melhorada **navegação por teclado** com suporte a Escape e Enter em overlays
  - Adicionados **aria-pressed** em botões de filtro para indicar estado ativo
  - Implementados **aria-expanded** em botões de toggle para indicar estado de expansão
  - Melhorados **breadcrumbs** com navegação ARIA apropriada
  - Adicionados **role="status"** em spinners de loading para feedback de estado
  - Melhorados **labels descritivos** em todos os inputs e selects
  - Implementado **aria-label** contextual em notificações com contadores
  - Adicionados **focus trap** em modais para melhor navegação por teclado
  
  **Componentes melhorados:**
  - ✅ CampaignListView: 10+ melhorias (ARIA, focus, empty state, pagination)
  - ✅ DashboardShell: 20+ melhorias (navegação, sidebar, mobile menu, breadcrumbs)
  - ✅ ContactListView: 10+ melhorias (botões de ação, filtros, busca)
  - ✅ TemplateListView: 10+ melhorias (filtros, botões de ação, busca)
  - ✅ DashboardView: Melhorias em CTAs e focus states
  
  **Impacto:**
  - 📱 Melhor experiência para usuários de teclado
  - ♿ Compatibilidade com leitores de tela (NVDA, JAWS, VoiceOver)
  - 🎯 Navegação mais intuitiva e previsível
  - ✨ Feedback visual e sonoro consistente

## 24/12/2025

- **Contexto compacto para IA (WhatsApp docs)**
  - Adicionado script `npm run whatsapp:context` para gerar `docs/whatsapp.context.md` a partir de `docs/whatsapp.json`.
  - Objetivo: permitir passar **um único arquivo menor** como contexto, evitando enviar ~17MB para a IA.

