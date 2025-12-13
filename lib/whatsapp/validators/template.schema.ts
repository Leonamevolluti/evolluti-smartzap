import { z } from 'zod';

// =========================
// BOTÕES - TODOS OS TIPOS
// =========================

// 1. Quick Reply - Respostas rápidas
/** Schema Zod para botão do tipo QUICK_REPLY (resposta rápida). */
export const QuickReplyButtonSchema = z.object({
    type: z.literal('QUICK_REPLY'),
    text: z.string().min(1).max(25, 'Botão: máximo 25 caracteres'),
});

// 2. URL - Link para website (suporta variáveis dinâmicas)
/** Schema Zod para botão do tipo URL (link externo), com validações de política Meta. */
export const UrlButtonSchema = z.object({
    type: z.literal('URL'),
    text: z.string().max(25, 'Texto do botão deve ter no máximo 25 caracteres'),
    url: z.string().url('URL inválida')
        .max(2000, 'URL muito longa')
        .refine((url) => !url.includes('wa.me') && !url.includes('whatsapp.com'), {
            message: "POLÍTICA META: Não é permitido usar links diretos do WhatsApp (wa.me, chat.whatsapp.com) em botões."
        }),
    example: z.array(z.string()).optional(), // Para URLs com {{1}} variável
});

// 3. Phone Number - Ligar para telefone
/** Schema Zod para botão do tipo PHONE_NUMBER (chamada telefônica). */
export const PhoneButtonSchema = z.object({
    type: z.literal('PHONE_NUMBER'),
    text: z.string().min(1).max(25, 'Botão: máximo 25 caracteres'),
    phone_number: z.string().min(10, 'Número de telefone inválido'),
});

// 4. Copy Code - Copiar código (cupom, OTP)
/** Schema Zod para botão do tipo COPY_CODE (copiar código/cupom). */
export const CopyCodeButtonSchema = z.object({
    type: z.literal('COPY_CODE'),
    example: z.string().optional(), // Exemplo do código
});

// 5. OTP Button - Para templates de autenticação
/** Schema Zod para botão do tipo OTP em templates de autenticação. */
export const OtpButtonSchema = z.object({
    type: z.literal('OTP'),
    otp_type: z.enum(['COPY_CODE', 'ONE_TAP', 'ZERO_TAP']),
    text: z.string().max(25).optional(), // Texto do botão
    autofill_text: z.string().optional(), // Texto de auto-preenchimento
    package_name: z.string().optional(), // Android package (para ONE_TAP)
    signature_hash: z.string().optional(), // Android signature (para ONE_TAP)
});

// 6. Flow Button - WhatsApp Flows
/** Schema Zod para botão do tipo FLOW (WhatsApp Flows). */
export const FlowButtonSchema = z.object({
    type: z.literal('FLOW'),
    text: z.string().min(1).max(25, 'Botão: máximo 25 caracteres'),
    flow_id: z.string(),
    flow_action: z.enum(['navigate', 'data_exchange']).optional(),
    navigate_screen: z.string().optional(),
});

// 7. Catalog Button - Ver catálogo
/** Schema Zod para botão do tipo CATALOG (abrir catálogo). */
export const CatalogButtonSchema = z.object({
    type: z.literal('CATALOG'),
    text: z.string().min(1).max(25).default('Ver catálogo'),
});

// 8. MPM Button - Multi-Product Message
/** Schema Zod para botão do tipo MPM (multi-produto). */
export const MpmButtonSchema = z.object({
    type: z.literal('MPM'),
    text: z.string().min(1).max(25).default('Ver produtos'),
});

// 9. Voice Call Button - Chamada de voz
/** Schema Zod para botão do tipo VOICE_CALL (chamada de voz). */
export const VoiceCallButtonSchema = z.object({
    type: z.literal('VOICE_CALL'),
    text: z.string().min(1).max(25, 'Botão: máximo 25 caracteres'),
});

// Union de todos os tipos de botão
/**
 * Union discriminada (`type`) de todos os tipos de botões suportados.
 *
 * Use este schema ao validar listas de botões em templates.
 */
export const ButtonSchema = z.discriminatedUnion('type', [
    QuickReplyButtonSchema,
    UrlButtonSchema,
    PhoneButtonSchema,
    CopyCodeButtonSchema,
    OtpButtonSchema,
    FlowButtonSchema,
    CatalogButtonSchema,
    MpmButtonSchema,
    VoiceCallButtonSchema,
]);

// =========================
// HEADER - TODOS OS FORMATOS
// =========================

/**
 * Schema Zod para HEADER do template.
 *
 * Suporta formatos: TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION.
 */
export const HeaderSchema = z.object({
    format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']),
    // Para TEXT
    text: z.string().max(60, 'Header texto: máximo 60 caracteres').optional(),
    // Para mídia (IMAGE, VIDEO, DOCUMENT)
    example: z.object({
        header_text: z.array(z.string()).optional(), // Para variáveis {{1}} no texto
        header_handle: z.array(z.string()).optional(), // ID da mídia uploadada
    }).optional().nullable(),
}).optional().nullable();

// =========================
// FOOTER
// =========================

/** Schema Zod para FOOTER do template (texto curto). */
export const FooterSchema = z.object({
    text: z.string().max(60, 'Footer: máximo 60 caracteres'),
}).optional().nullable();

// =========================
// BODY
// =========================

/**
 * Schema Zod para BODY do template.
 *
 * Inclui suporte a exemplos de variáveis (`body_text`).
 */
export const BodySchema = z.object({
    text: z.string().min(1, 'Conteúdo obrigatório').max(1024, 'Body: máximo 1024 caracteres'),
    example: z.object({
        body_text: z.array(z.array(z.string())).optional(),
    }).optional(),
});

// =========================
// CAROUSEL - Cards deslizantes
// =========================

/** Schema Zod para um card de carousel (mídia + texto + botões). */
export const CarouselCardSchema = z.object({
    header: z.object({
        format: z.enum(['IMAGE', 'VIDEO']),
        example: z.object({
            header_handle: z.array(z.string()),
        }),
    }),
    body: z.object({
        text: z.string().max(160),
        example: z.object({
            body_text: z.array(z.array(z.string())).optional(),
        }).optional(),
    }),
    buttons: z.array(ButtonSchema).max(2),
});

/** Schema Zod para carousel (2 a 10 cards). */
export const CarouselSchema = z.object({
    cards: z.array(CarouselCardSchema).min(2).max(10),
}).optional().nullable();

// =========================
// LIMITED TIME OFFER
// =========================

/** Schema Zod para Limited Time Offer (LTO) em templates de marketing. */
export const LimitedTimeOfferSchema = z.object({
    text: z.string().max(16, 'LTO texto: máximo 16 caracteres'),
    has_expiration: z.boolean().default(true),
}).optional().nullable();

// =========================
// SCHEMA PRINCIPAL
// =========================

/**
 * Schema Zod principal para criação de template (payload vindo da UI/API).
 *
 * Este schema aplica:
 * - regras de formato/nome do template;
 * - validação de componentes (header/body/footer/buttons/carousel);
 * - campos específicos de autenticação (TTL/expiração de código).
 */
export const CreateTemplateSchema = z.object({
    // Campos opcionais para update no banco
    projectId: z.string().optional(),
    itemId: z.string().optional(),

    // Campos obrigatórios
    name: z.string()
        .min(1, 'Nome obrigatório')
        .max(512, 'Nome muito longo')
        .regex(/^[a-z0-9_]+$/, 'Nome: apenas letras minúsculas, números e underscore'),
    language: z.string().default('pt_BR'),
    category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),

    // Body (pode vir como content para compatibilidade ou como objeto body)
    content: z.string().min(1).max(1024).optional(),
    body: BodySchema.optional(),

    // Componentes opcionais
    header: HeaderSchema,
    footer: FooterSchema,
    buttons: z.array(ButtonSchema).max(10, 'Máximo 10 botões').optional().nullable(),

    // Carousel (alternativo ao body simples)
    carousel: CarouselSchema,

    // Limited Time Offer (para MARKETING)
    limited_time_offer: LimitedTimeOfferSchema,

    // Variáveis de exemplo (shortcut)
    exampleVariables: z.array(z.string()).optional(),

    // Para Authentication templates
    message_send_ttl_seconds: z.number().min(60).max(600).optional(),
    add_security_recommendation: z.boolean().optional(),
    code_expiration_minutes: z.number().min(1).max(90).optional(),
});
