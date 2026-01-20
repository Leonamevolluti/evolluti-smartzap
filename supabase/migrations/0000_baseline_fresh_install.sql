--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: get_dashboard_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_dashboard_stats() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  total_sent bigint;
  total_delivered bigint;
  total_read bigint;
  total_failed bigint;
  active_campaigns bigint;
  delivery_rate integer;
BEGIN
  SELECT 
    coalesce(sum(sent), 0),
    coalesce(sum(delivered), 0),
    coalesce(sum(read), 0),
    coalesce(sum(failed), 0)
  INTO 
    total_sent,
    total_delivered,
    total_read,
    total_failed
  FROM campaigns;

  SELECT count(*)
  INTO active_campaigns
  FROM campaigns
  WHERE status in ('Enviando', 'Agendado');

  IF total_sent > 0 THEN
    delivery_rate := round((total_delivered::numeric / total_sent::numeric) * 100);
  ELSE
    delivery_rate := 0;
  END IF;

  RETURN json_build_object(
    'totalSent', total_sent,
    'totalDelivered', total_delivered,
    'totalRead', total_read,
    'totalFailed', total_failed,
    'activeCampaigns', active_campaigns,
    'deliveryRate', delivery_rate
  );
END;
$$;


--
-- Name: increment_campaign_stat(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_campaign_stat(campaign_id_input text, field text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF field = 'sent' THEN
    UPDATE campaigns SET sent = COALESCE(sent, 0) + 1 WHERE id = campaign_id_input;
  ELSIF field = 'delivered' THEN
    UPDATE campaigns SET delivered = COALESCE(delivered, 0) + 1 WHERE id = campaign_id_input;
  ELSIF field = 'read' THEN
    UPDATE campaigns SET read = COALESCE(read, 0) + 1 WHERE id = campaign_id_input;
  ELSIF field = 'failed' THEN
    UPDATE campaigns SET failed = COALESCE(failed, 0) + 1 WHERE id = campaign_id_input;
  END IF;
END;
$$;


--
-- Name: update_campaign_dispatch_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_campaign_dispatch_metrics() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  -- When a contact is first claimed (sending_at set), set first_dispatch_at once.
  if (new.sending_at is not null) and (old.sending_at is null) then
    update public.campaigns
      set first_dispatch_at = coalesce(first_dispatch_at, new.sending_at)
      where id = new.campaign_id;
  end if;

  -- When a contact gets a sent_at for the first time, push last_sent_at forward.
  if (new.sent_at is not null) and (old.sent_at is null) then
    update public.campaigns
      set last_sent_at = greatest(coalesce(last_sent_at, new.sent_at), new.sent_at)
      where id = new.campaign_id;
  end if;

  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_alerts (
    id text DEFAULT concat('alert_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    type text NOT NULL,
    code integer,
    message text NOT NULL,
    details jsonb,
    dismissed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_batch_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_batch_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id text NOT NULL,
    trace_id text NOT NULL,
    batch_index integer NOT NULL,
    configured_batch_size integer,
    batch_size integer NOT NULL,
    concurrency integer NOT NULL,
    adaptive_enabled boolean DEFAULT false NOT NULL,
    target_mps integer,
    floor_delay_ms integer,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    meta_requests integer DEFAULT 0 NOT NULL,
    meta_time_ms integer DEFAULT 0 NOT NULL,
    db_time_ms integer DEFAULT 0 NOT NULL,
    saw_throughput_429 boolean DEFAULT false NOT NULL,
    batch_ok boolean DEFAULT true NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_contacts (
    id text DEFAULT concat('cc_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    campaign_id text NOT NULL,
    contact_id text,
    phone text NOT NULL,
    name text,
    email text,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    message_id text,
    sending_at timestamp with time zone,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    skipped_at timestamp with time zone,
    error text,
    skip_code text,
    skip_reason text,
    failure_code integer,
    failure_reason text,
    trace_id text,
    failure_title text,
    failure_details text,
    failure_fbtrace_id text,
    failure_subcode integer,
    failure_href text,
    CONSTRAINT campaign_contacts_skipped_reason_check CHECK (((status <> 'skipped'::text) OR (failure_reason IS NOT NULL) OR (error IS NOT NULL)))
);


--
-- Name: COLUMN campaign_contacts.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.email IS 'Snapshot do email do contato no momento da criação da campanha';


--
-- Name: COLUMN campaign_contacts.custom_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.custom_fields IS 'Snapshot dos custom_fields do contato no momento da criação da campanha';


--
-- Name: COLUMN campaign_contacts.sending_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.sending_at IS 'Quando o contato foi "claimado" para envio (idempotência/at-least-once)';


--
-- Name: COLUMN campaign_contacts.skipped_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.skipped_at IS 'Quando o envio foi ignorado pelo pré-check/guard-rail';


--
-- Name: COLUMN campaign_contacts.skip_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.skip_code IS 'Código estável do motivo de skip (ex.: MISSING_REQUIRED_PARAM)';


--
-- Name: COLUMN campaign_contacts.skip_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaign_contacts.skip_reason IS 'Motivo legível do skip (para UI e auditoria)';


--
-- Name: campaign_run_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_run_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id text NOT NULL,
    trace_id text NOT NULL,
    template_name text,
    recipients integer,
    sent_total integer,
    failed_total integer,
    skipped_total integer,
    first_dispatch_at timestamp with time zone,
    last_sent_at timestamp with time zone,
    dispatch_duration_ms integer,
    throughput_mps numeric,
    meta_avg_ms numeric,
    db_avg_ms numeric,
    saw_throughput_429 boolean DEFAULT false NOT NULL,
    config jsonb,
    config_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id text DEFAULT concat('c_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'Rascunho'::text NOT NULL,
    template_name text,
    template_id text,
    template_variables jsonb,
    template_snapshot jsonb,
    template_spec_hash text,
    template_parameter_format text,
    template_fetched_at timestamp with time zone,
    scheduled_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    total_recipients integer DEFAULT 0,
    sent integer DEFAULT 0,
    delivered integer DEFAULT 0,
    read integer DEFAULT 0,
    failed integer DEFAULT 0,
    skipped integer DEFAULT 0,
    last_sent_at timestamp with time zone,
    first_dispatch_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    qstash_schedule_message_id text,
    qstash_schedule_enqueued_at timestamp with time zone,
    flow_id text,
    flow_name text
);


--
-- Name: COLUMN campaigns.flow_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaigns.flow_id IS 'ID do Flow/MiniApp usado na campanha (meta_flow_id)';


--
-- Name: COLUMN campaigns.flow_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campaigns.flow_name IS 'Nome do Flow para exibição';


--
-- Name: campaign_stats_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.campaign_stats_summary AS
 SELECT (count(*))::integer AS total_campaigns,
    (COALESCE(sum(sent), (0)::bigint))::integer AS total_sent,
    (COALESCE(sum(delivered), (0)::bigint))::integer AS total_delivered,
    (COALESCE(sum(read), (0)::bigint))::integer AS total_read,
    (COALESCE(sum(failed), (0)::bigint))::integer AS total_failed,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['enviando'::text, 'sending'::text, 'SENDING'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS active_campaigns,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['concluida'::text, 'completed'::text, 'COMPLETED'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS completed_campaigns,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['rascunho'::text, 'draft'::text, 'DRAFT'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS draft_campaigns,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['pausado'::text, 'paused'::text, 'PAUSED'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS paused_campaigns,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['agendado'::text, 'scheduled'::text, 'SCHEDULED'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS scheduled_campaigns,
    (count(
        CASE
            WHEN (status = ANY (ARRAY['falhou'::text, 'failed'::text, 'FAILED'::text])) THEN 1
            ELSE NULL::integer
        END))::integer AS failed_campaigns,
    (COALESCE(sum(
        CASE
            WHEN (created_at > (now() - '24:00:00'::interval)) THEN sent
            ELSE 0
        END), (0)::bigint))::integer AS sent_24h,
    (COALESCE(sum(
        CASE
            WHEN (created_at > (now() - '24:00:00'::interval)) THEN delivered
            ELSE 0
        END), (0)::bigint))::integer AS delivered_24h,
    (COALESCE(sum(
        CASE
            WHEN (created_at > (now() - '24:00:00'::interval)) THEN failed
            ELSE 0
        END), (0)::bigint))::integer AS failed_24h
   FROM public.campaigns;


--
-- Name: VIEW campaign_stats_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.campaign_stats_summary IS 'Pre-aggregated campaign statistics for dashboard. Reduces DB queries from O(n) to O(1).';


--
-- Name: campaign_trace_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_trace_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trace_id text NOT NULL,
    ts timestamp with time zone NOT NULL,
    campaign_id text,
    step text,
    phase text NOT NULL,
    ok boolean,
    ms integer,
    batch_index integer,
    contact_id text,
    phone_masked text,
    extra jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id text DEFAULT concat('ct_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    phone text NOT NULL,
    email text,
    status text DEFAULT 'Opt-in'::text,
    tags jsonb DEFAULT '[]'::jsonb,
    notes text,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: custom_field_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_definitions (
    id text DEFAULT concat('cfd_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    options jsonb,
    entity_type text DEFAULT 'contact'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flow_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_submissions (
    id text DEFAULT concat('fs_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    message_id text NOT NULL,
    from_phone text NOT NULL,
    contact_id text,
    flow_id text,
    flow_name text,
    flow_token text,
    response_json_raw text NOT NULL,
    response_json jsonb,
    waba_id text,
    phone_number_id text,
    message_timestamp timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    flow_local_id text,
    mapped_data jsonb,
    mapped_at timestamp with time zone,
    campaign_id text
);


--
-- Name: flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flows (
    id text DEFAULT concat('fl_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    meta_flow_id text,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    template_key text,
    flow_json jsonb,
    flow_version text,
    mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    meta_status text,
    meta_preview_url text,
    meta_validation_errors jsonb,
    meta_last_checked_at timestamp with time zone,
    meta_published_at timestamp with time zone
);


--
-- Name: lead_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_forms (
    id text DEFAULT concat('lf_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    tag text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    success_message text,
    webhook_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    collect_email boolean DEFAULT true NOT NULL
);


--
-- Name: phone_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_suppressions (
    id text DEFAULT concat('ps_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    phone text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    reason text,
    source text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: TABLE phone_suppressions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.phone_suppressions IS 'Lista global de supressão (não enviar para estes telefones).';


--
-- Name: COLUMN phone_suppressions.phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phone_suppressions.phone IS 'Telefone normalizado em E.164 (ex.: +5511999999999)';


--
-- Name: COLUMN phone_suppressions.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phone_suppressions.source IS 'Origem: inbound_keyword, meta_opt_out_error, manual, etc.';


--
-- Name: COLUMN phone_suppressions.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phone_suppressions.expires_at IS 'Quando definido, a supressão expira automaticamente (quarentena).';


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: template_project_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_project_items (
    id text DEFAULT concat('tpi_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    language text DEFAULT 'pt_BR'::text,
    category text DEFAULT 'UTILITY'::text,
    status text DEFAULT 'draft'::text,
    meta_id text,
    meta_status text,
    rejected_reason text,
    submitted_at timestamp with time zone,
    components jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: template_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_projects (
    id text DEFAULT concat('tp_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    user_id text,
    title text NOT NULL,
    prompt text,
    status text DEFAULT 'draft'::text,
    template_count integer DEFAULT 0,
    approved_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templates (
    id text DEFAULT concat('tpl_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    name text NOT NULL,
    category text,
    language text DEFAULT 'pt_BR'::text,
    status text,
    parameter_format text DEFAULT 'positional'::text,
    components jsonb,
    spec_hash text,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    header_media_preview_url text,
    header_media_preview_expires_at timestamp with time zone,
    header_media_preview_updated_at timestamp with time zone
);


--
-- Name: whatsapp_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_status_events (
    id text DEFAULT concat('wse_', replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    message_id text NOT NULL,
    status text NOT NULL,
    event_ts timestamp with time zone,
    event_ts_raw text,
    dedupe_key text NOT NULL,
    recipient_id text,
    errors jsonb,
    payload jsonb,
    apply_state text DEFAULT 'pending'::text NOT NULL,
    applied boolean DEFAULT false NOT NULL,
    applied_at timestamp with time zone,
    apply_error text,
    attempts integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    campaign_contact_id text,
    campaign_id text,
    first_received_at timestamp with time zone DEFAULT now() NOT NULL,
    last_received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_builder_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_builder_executions (
    id text NOT NULL,
    workflow_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    input jsonb,
    output jsonb,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: workflow_builder_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_builder_logs (
    id bigint NOT NULL,
    execution_id text NOT NULL,
    node_id text NOT NULL,
    node_name text,
    node_type text,
    status text NOT NULL,
    input jsonb,
    output jsonb,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: workflow_builder_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_builder_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_builder_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_builder_logs_id_seq OWNED BY public.workflow_builder_logs.id;


--
-- Name: workflow_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_conversations (
    id text NOT NULL,
    workflow_id text NOT NULL,
    phone text NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    resume_node_id text,
    variable_key text,
    variables jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_run_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_run_logs (
    id bigint NOT NULL,
    run_id text NOT NULL,
    node_id text NOT NULL,
    node_name text,
    node_type text,
    status text NOT NULL,
    input jsonb,
    output jsonb,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: workflow_run_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_run_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_run_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_run_logs_id_seq OWNED BY public.workflow_run_logs.id;


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id text NOT NULL,
    workflow_id text NOT NULL,
    version_id text,
    status text DEFAULT 'running'::text NOT NULL,
    trigger_type text,
    input jsonb,
    output jsonb,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: workflow_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_versions (
    id text NOT NULL,
    workflow_id text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    nodes jsonb NOT NULL,
    edges jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflows (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    owner_company_id text,
    active_version_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_builder_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_builder_logs ALTER COLUMN id SET DEFAULT nextval('public.workflow_builder_logs_id_seq'::regclass);


--
-- Name: workflow_run_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_run_logs ALTER COLUMN id SET DEFAULT nextval('public.workflow_run_logs_id_seq'::regclass);


--
-- Name: account_alerts account_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_alerts
    ADD CONSTRAINT account_alerts_pkey PRIMARY KEY (id);


--
-- Name: campaign_batch_metrics campaign_batch_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_batch_metrics
    ADD CONSTRAINT campaign_batch_metrics_pkey PRIMARY KEY (id);


--
-- Name: campaign_contacts campaign_contacts_campaign_id_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contacts
    ADD CONSTRAINT campaign_contacts_campaign_id_contact_id_key UNIQUE (campaign_id, contact_id);


--
-- Name: campaign_contacts campaign_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contacts
    ADD CONSTRAINT campaign_contacts_pkey PRIMARY KEY (id);


--
-- Name: campaign_run_metrics campaign_run_metrics_campaign_id_trace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_run_metrics
    ADD CONSTRAINT campaign_run_metrics_campaign_id_trace_id_key UNIQUE (campaign_id, trace_id);


--
-- Name: campaign_run_metrics campaign_run_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_run_metrics
    ADD CONSTRAINT campaign_run_metrics_pkey PRIMARY KEY (id);


--
-- Name: campaign_trace_events campaign_trace_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_trace_events
    ADD CONSTRAINT campaign_trace_events_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_phone_key UNIQUE (phone);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: custom_field_definitions custom_field_definitions_entity_type_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_entity_type_key_key UNIQUE (entity_type, key);


--
-- Name: custom_field_definitions custom_field_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id);


--
-- Name: flow_submissions flow_submissions_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_submissions
    ADD CONSTRAINT flow_submissions_message_id_key UNIQUE (message_id);


--
-- Name: flow_submissions flow_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_submissions
    ADD CONSTRAINT flow_submissions_pkey PRIMARY KEY (id);


--
-- Name: flows flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);


--
-- Name: lead_forms lead_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_forms
    ADD CONSTRAINT lead_forms_pkey PRIMARY KEY (id);


--
-- Name: lead_forms lead_forms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_forms
    ADD CONSTRAINT lead_forms_slug_key UNIQUE (slug);


--
-- Name: lead_forms lead_forms_webhook_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_forms
    ADD CONSTRAINT lead_forms_webhook_token_key UNIQUE (webhook_token);


--
-- Name: phone_suppressions phone_suppressions_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_suppressions
    ADD CONSTRAINT phone_suppressions_phone_key UNIQUE (phone);


--
-- Name: phone_suppressions phone_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_suppressions
    ADD CONSTRAINT phone_suppressions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: template_project_items template_project_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_project_items
    ADD CONSTRAINT template_project_items_pkey PRIMARY KEY (id);


--
-- Name: template_projects template_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_projects
    ADD CONSTRAINT template_projects_pkey PRIMARY KEY (id);


--
-- Name: templates templates_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_name_key UNIQUE (name);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_status_events whatsapp_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_status_events
    ADD CONSTRAINT whatsapp_status_events_pkey PRIMARY KEY (id);


--
-- Name: workflow_builder_executions workflow_builder_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_builder_executions
    ADD CONSTRAINT workflow_builder_executions_pkey PRIMARY KEY (id);


--
-- Name: workflow_builder_logs workflow_builder_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_builder_logs
    ADD CONSTRAINT workflow_builder_logs_pkey PRIMARY KEY (id);


--
-- Name: workflow_conversations workflow_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_conversations
    ADD CONSTRAINT workflow_conversations_pkey PRIMARY KEY (id);


--
-- Name: workflow_run_logs workflow_run_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_run_logs
    ADD CONSTRAINT workflow_run_logs_pkey PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflow_versions workflow_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_versions
    ADD CONSTRAINT workflow_versions_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: campaign_batch_metrics_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_batch_metrics_campaign_idx ON public.campaign_batch_metrics USING btree (campaign_id, created_at DESC);


--
-- Name: campaign_batch_metrics_trace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_batch_metrics_trace_idx ON public.campaign_batch_metrics USING btree (trace_id, batch_index);


--
-- Name: campaign_run_metrics_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_run_metrics_campaign_idx ON public.campaign_run_metrics USING btree (campaign_id, created_at DESC);


--
-- Name: campaign_run_metrics_config_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_run_metrics_config_hash_idx ON public.campaign_run_metrics USING btree (config_hash, created_at DESC);


--
-- Name: campaign_run_metrics_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_run_metrics_created_idx ON public.campaign_run_metrics USING btree (created_at DESC);


--
-- Name: campaign_trace_events_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_trace_events_campaign_idx ON public.campaign_trace_events USING btree (campaign_id, ts DESC);


--
-- Name: campaign_trace_events_trace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_trace_events_trace_idx ON public.campaign_trace_events USING btree (trace_id, ts DESC);


--
-- Name: campaign_trace_events_trace_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_trace_events_trace_phase_idx ON public.campaign_trace_events USING btree (trace_id, phase, ts DESC);


--
-- Name: campaigns_cancelled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_cancelled_at_idx ON public.campaigns USING btree (cancelled_at);


--
-- Name: campaigns_first_dispatch_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_first_dispatch_at_idx ON public.campaigns USING btree (first_dispatch_at DESC);


--
-- Name: campaigns_last_sent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_last_sent_at_idx ON public.campaigns USING btree (last_sent_at DESC);


--
-- Name: idx_account_alerts_dismissed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_alerts_dismissed ON public.account_alerts USING btree (dismissed);


--
-- Name: idx_account_alerts_dismissed_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_alerts_dismissed_created ON public.account_alerts USING btree (dismissed, created_at DESC);


--
-- Name: idx_account_alerts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_alerts_type ON public.account_alerts USING btree (type);


--
-- Name: idx_campaign_contacts_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_campaign ON public.campaign_contacts USING btree (campaign_id);


--
-- Name: idx_campaign_contacts_campaign_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_campaign_phone ON public.campaign_contacts USING btree (campaign_id, phone);


--
-- Name: idx_campaign_contacts_failed_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_failed_recent ON public.campaign_contacts USING btree (campaign_id, failed_at DESC) WHERE (status = 'failed'::text);


--
-- Name: idx_campaign_contacts_failure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_failure ON public.campaign_contacts USING btree (failure_code);


--
-- Name: idx_campaign_contacts_failure_fbtrace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_failure_fbtrace_id ON public.campaign_contacts USING btree (failure_fbtrace_id);


--
-- Name: idx_campaign_contacts_failure_subcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_failure_subcode ON public.campaign_contacts USING btree (failure_subcode);


--
-- Name: idx_campaign_contacts_failure_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_failure_title ON public.campaign_contacts USING btree (failure_title);


--
-- Name: idx_campaign_contacts_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_message_id ON public.campaign_contacts USING btree (message_id);


--
-- Name: idx_campaign_contacts_sending_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_sending_at ON public.campaign_contacts USING btree (sending_at DESC);


--
-- Name: idx_campaign_contacts_skipped_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_skipped_at ON public.campaign_contacts USING btree (skipped_at DESC);


--
-- Name: idx_campaign_contacts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_status ON public.campaign_contacts USING btree (status);


--
-- Name: idx_campaign_contacts_trace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_contacts_trace_id ON public.campaign_contacts USING btree (trace_id);


--
-- Name: idx_campaigns_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_created_at ON public.campaigns USING btree (created_at DESC);


--
-- Name: idx_campaigns_flow_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_flow_id ON public.campaigns USING btree (flow_id) WHERE (flow_id IS NOT NULL);


--
-- Name: idx_campaigns_qstash_schedule_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_qstash_schedule_message_id ON public.campaigns USING btree (qstash_schedule_message_id);


--
-- Name: idx_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_status ON public.campaigns USING btree (status);


--
-- Name: idx_contacts_custom_fields; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_custom_fields ON public.contacts USING gin (custom_fields);


--
-- Name: idx_contacts_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_phone ON public.contacts USING btree (phone);


--
-- Name: idx_contacts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_status ON public.contacts USING btree (status);


--
-- Name: idx_custom_field_definitions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_field_definitions_entity ON public.custom_field_definitions USING btree (entity_type);


--
-- Name: idx_flow_submissions_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_campaign_id ON public.flow_submissions USING btree (campaign_id);


--
-- Name: idx_flow_submissions_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_contact_id ON public.flow_submissions USING btree (contact_id);


--
-- Name: idx_flow_submissions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_created_at ON public.flow_submissions USING btree (created_at DESC);


--
-- Name: idx_flow_submissions_flow_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_flow_id ON public.flow_submissions USING btree (flow_id);


--
-- Name: idx_flow_submissions_flow_local_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_flow_local_id ON public.flow_submissions USING btree (flow_local_id);


--
-- Name: idx_flow_submissions_from_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_submissions_from_phone ON public.flow_submissions USING btree (from_phone);


--
-- Name: idx_flows_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_created_at ON public.flows USING btree (created_at DESC);


--
-- Name: idx_flows_meta_flow_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_meta_flow_id ON public.flows USING btree (meta_flow_id);


--
-- Name: idx_flows_meta_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_meta_status ON public.flows USING btree (meta_status);


--
-- Name: idx_flows_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_status ON public.flows USING btree (status);


--
-- Name: idx_flows_template_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flows_template_key ON public.flows USING btree (template_key);


--
-- Name: idx_lead_forms_collect_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_forms_collect_email ON public.lead_forms USING btree (collect_email);


--
-- Name: idx_lead_forms_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_forms_is_active ON public.lead_forms USING btree (is_active);


--
-- Name: idx_lead_forms_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_forms_slug ON public.lead_forms USING btree (slug);


--
-- Name: idx_phone_suppressions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_suppressions_active ON public.phone_suppressions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_phone_suppressions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_suppressions_expires ON public.phone_suppressions USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_phone_suppressions_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_suppressions_phone ON public.phone_suppressions USING btree (phone);


--
-- Name: idx_template_project_items_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_project_items_project ON public.template_project_items USING btree (project_id);


--
-- Name: idx_template_project_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_project_items_status ON public.template_project_items USING btree (status);


--
-- Name: idx_template_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_projects_status ON public.template_projects USING btree (status);


--
-- Name: idx_templates_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_templates_name ON public.templates USING btree (name);


--
-- Name: idx_templates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_templates_status ON public.templates USING btree (status);


--
-- Name: idx_whatsapp_status_events_apply_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_status_events_apply_state ON public.whatsapp_status_events USING btree (apply_state);


--
-- Name: idx_whatsapp_status_events_last_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_status_events_last_received_at ON public.whatsapp_status_events USING btree (last_received_at DESC);


--
-- Name: idx_whatsapp_status_events_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_status_events_message_id ON public.whatsapp_status_events USING btree (message_id);


--
-- Name: lead_forms_fields_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_forms_fields_gin_idx ON public.lead_forms USING gin (fields);


--
-- Name: ux_whatsapp_status_events_dedupe_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_whatsapp_status_events_dedupe_key ON public.whatsapp_status_events USING btree (dedupe_key);


--
-- Name: workflow_builder_executions_workflow_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_builder_executions_workflow_id_idx ON public.workflow_builder_executions USING btree (workflow_id, started_at DESC);


--
-- Name: workflow_builder_logs_execution_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_builder_logs_execution_id_idx ON public.workflow_builder_logs USING btree (execution_id, started_at DESC);


--
-- Name: workflow_conversations_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_conversations_phone_idx ON public.workflow_conversations USING btree (phone, updated_at DESC);


--
-- Name: workflow_conversations_workflow_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_conversations_workflow_id_idx ON public.workflow_conversations USING btree (workflow_id, updated_at DESC);


--
-- Name: workflow_run_logs_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_run_logs_run_id_idx ON public.workflow_run_logs USING btree (run_id, started_at DESC);


--
-- Name: workflow_runs_version_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_runs_version_id_idx ON public.workflow_runs USING btree (version_id, started_at DESC);


--
-- Name: workflow_runs_workflow_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_runs_workflow_id_idx ON public.workflow_runs USING btree (workflow_id, started_at DESC);


--
-- Name: workflow_versions_workflow_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_versions_workflow_id_idx ON public.workflow_versions USING btree (workflow_id, created_at DESC);


--
-- Name: workflow_versions_workflow_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_versions_workflow_version_idx ON public.workflow_versions USING btree (workflow_id, version);


--
-- Name: campaign_contacts trg_campaign_contacts_dispatch_metrics; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_campaign_contacts_dispatch_metrics AFTER UPDATE OF sending_at, sent_at ON public.campaign_contacts FOR EACH ROW EXECUTE FUNCTION public.update_campaign_dispatch_metrics();


--
-- Name: campaign_contacts campaign_contacts_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contacts
    ADD CONSTRAINT campaign_contacts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_contacts campaign_contacts_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_contacts
    ADD CONSTRAINT campaign_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: flow_submissions flow_submissions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_submissions
    ADD CONSTRAINT flow_submissions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: flow_submissions flow_submissions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_submissions
    ADD CONSTRAINT flow_submissions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: flow_submissions flow_submissions_flow_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_submissions
    ADD CONSTRAINT flow_submissions_flow_local_id_fkey FOREIGN KEY (flow_local_id) REFERENCES public.flows(id) ON DELETE SET NULL;


--
-- Name: template_project_items template_project_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_project_items
    ADD CONSTRAINT template_project_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.template_projects(id) ON DELETE CASCADE;


--
-- Name: whatsapp_status_events whatsapp_status_events_campaign_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_status_events
    ADD CONSTRAINT whatsapp_status_events_campaign_contact_id_fkey FOREIGN KEY (campaign_contact_id) REFERENCES public.campaign_contacts(id) ON DELETE SET NULL;


--
-- Name: whatsapp_status_events whatsapp_status_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_status_events
    ADD CONSTRAINT whatsapp_status_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: workflow_builder_logs workflow_builder_logs_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_builder_logs
    ADD CONSTRAINT workflow_builder_logs_execution_id_fkey FOREIGN KEY (execution_id) REFERENCES public.workflow_builder_executions(id) ON DELETE CASCADE;


--
-- Name: workflow_conversations workflow_conversations_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_conversations
    ADD CONSTRAINT workflow_conversations_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_run_logs workflow_run_logs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_run_logs
    ADD CONSTRAINT workflow_run_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.workflow_runs(id) ON DELETE CASCADE;


--
-- Name: workflow_runs workflow_runs_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.workflow_versions(id) ON DELETE SET NULL;


--
-- Name: workflow_runs workflow_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_versions workflow_versions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_versions
    ADD CONSTRAINT workflow_versions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_active_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_active_version_fk FOREIGN KEY (active_version_id) REFERENCES public.workflow_versions(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

