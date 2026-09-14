--
-- PostgreSQL database dump
--

\restrict WPcz2V4hGf0a5zkegPdATnEJYUJJhOOVxTGKQWe1FFUvwDGbfUnyZgfgc52bCre

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: chunk_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chunk_status AS ENUM (
    'pending',
    'running',
    'done',
    'failed'
);


--
-- Name: ingestion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ingestion_status AS ENUM (
    'running',
    'paused',
    'completed',
    'failed',
    'aborted'
);


--
-- Name: pricing_rule_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_rule_type AS ENUM (
    'ingestion',
    'promotion'
);


--
-- Name: promotion_discount_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_discount_type AS ENUM (
    'percentage',
    'fixed'
);


--
-- Name: promotion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_status AS ENUM (
    'draft',
    'active',
    'cancelled'
);


--
-- Name: pricing_rules_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pricing_rules_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id bigint NOT NULL,
    name text NOT NULL,
    discount_type public.promotion_discount_type NOT NULL,
    value integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    product_id bigint,
    category text,
    status public.promotion_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    CONSTRAINT promotions_active_target_check CHECK (((status <> 'active'::public.promotion_status) OR ((product_id IS NULL) <> (category IS NULL)))),
    CONSTRAINT promotions_draft_target_check CHECK (((status <> 'draft'::public.promotion_status) OR ((product_id IS NULL) AND (category IS NULL)))),
    CONSTRAINT promotions_percentage_value_check CHECK (((discount_type <> 'percentage'::public.promotion_discount_type) OR (value <= 10000))),
    CONSTRAINT promotions_value_check CHECK ((value > 0)),
    CONSTRAINT promotions_window_check CHECK ((ends_at > starts_at))
);


--
-- Name: active_promotions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_promotions AS
 SELECT id,
    name,
    discount_type,
    value,
    starts_at,
    ends_at,
    product_id,
    category,
    status,
    created_at,
    cancelled_at
   FROM public.promotions
  WHERE ((status = 'active'::public.promotion_status) AND (tstzrange(starts_at, ends_at) @> now()));


--
-- Name: ingestion_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_chunks (
    job_id bigint NOT NULL,
    chunk_index integer NOT NULL,
    start_offset bigint NOT NULL,
    end_offset bigint NOT NULL,
    next_offset bigint NOT NULL,
    lease_until timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    rows_processed integer DEFAULT 0 NOT NULL,
    rows_rejected integer DEFAULT 0 NOT NULL,
    status public.chunk_status DEFAULT 'pending'::public.chunk_status NOT NULL,
    last_error text
);


--
-- Name: ingestion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_jobs (
    id bigint NOT NULL,
    vendor text NOT NULL,
    file_ref text NOT NULL,
    file_sha256 text NOT NULL,
    file_size_bytes bigint NOT NULL,
    chunks_total integer NOT NULL,
    chunks_done integer DEFAULT 0 NOT NULL,
    rows_processed bigint DEFAULT 0 NOT NULL,
    rows_rejected bigint DEFAULT 0 NOT NULL,
    status public.ingestion_status DEFAULT 'running'::public.ingestion_status NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ingestion_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ingestion_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ingestion_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pricing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_rules (
    id bigint NOT NULL,
    type public.pricing_rule_type NOT NULL,
    name text NOT NULL,
    conditions jsonb NOT NULL,
    event jsonb NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pricing_rules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pricing_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    base_price_cents bigint NOT NULL,
    stock_quantity integer NOT NULL,
    pricing_rules_version bigint,
    ingest_job_id bigint,
    ingest_source_offset bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_base_price_cents_check CHECK ((base_price_cents >= 0)),
    CONSTRAINT products_ingest_provenance_check CHECK (((ingest_job_id IS NULL) = (ingest_source_offset IS NULL))),
    CONSTRAINT products_stock_quantity_check CHECK ((stock_quantity >= 0))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.products ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: promotions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.promotions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.promotions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reconciler_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciler_state (
    id boolean DEFAULT true NOT NULL,
    last_boundary_sweep_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reconciler_state_single_row_check CHECK (id)
);


--
-- Name: ingestion_chunks ingestion_chunks_job_id_chunk_index_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_chunks
    ADD CONSTRAINT ingestion_chunks_job_id_chunk_index_pk PRIMARY KEY (job_id, chunk_index);


--
-- Name: ingestion_jobs ingestion_jobs_file_sha256_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_jobs
    ADD CONSTRAINT ingestion_jobs_file_sha256_unique UNIQUE (file_sha256);


--
-- Name: ingestion_jobs ingestion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_jobs
    ADD CONSTRAINT ingestion_jobs_pkey PRIMARY KEY (id);


--
-- Name: pricing_rules pricing_rules_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_name_unique UNIQUE (name);


--
-- Name: pricing_rules pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_rules
    ADD CONSTRAINT pricing_rules_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_unique UNIQUE (sku);


--
-- Name: promotions promotions_no_overlapping_active_category; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_no_overlapping_active_category EXCLUDE USING gist (category WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (((status = 'active'::public.promotion_status) AND (category IS NOT NULL)));


--
-- Name: promotions promotions_no_overlapping_active_product; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_no_overlapping_active_product EXCLUDE USING gist (product_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (((status = 'active'::public.promotion_status) AND (product_id IS NOT NULL)));


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: reconciler_state reconciler_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciler_state
    ADD CONSTRAINT reconciler_state_pkey PRIMARY KEY (id);


--
-- Name: ingestion_jobs_one_running_per_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ingestion_jobs_one_running_per_vendor ON public.ingestion_jobs USING btree (vendor) WHERE (status = ANY (ARRAY['running'::public.ingestion_status, 'paused'::public.ingestion_status]));


--
-- Name: pricing_rules_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_rules_active_idx ON public.pricing_rules USING btree (type, priority DESC NULLS LAST) WHERE active;


--
-- Name: products_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_category_id_idx ON public.products USING btree (category, id);


--
-- Name: promotions_cancelled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_cancelled_at_idx ON public.promotions USING btree (cancelled_at) WHERE (cancelled_at IS NOT NULL);


--
-- Name: promotions_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_category_id_idx ON public.promotions USING btree (category, id);


--
-- Name: promotions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_created_at_idx ON public.promotions USING btree (created_at) WHERE (status <> 'draft'::public.promotion_status);


--
-- Name: promotions_ends_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_ends_at_idx ON public.promotions USING btree (ends_at) WHERE (status <> 'draft'::public.promotion_status);


--
-- Name: promotions_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_product_id_idx ON public.promotions USING btree (product_id, id);


--
-- Name: promotions_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX promotions_starts_at_idx ON public.promotions USING btree (starts_at) WHERE (status <> 'draft'::public.promotion_status);


--
-- Name: pricing_rules pricing_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pricing_rules_set_updated_at BEFORE UPDATE ON public.pricing_rules FOR EACH ROW EXECUTE FUNCTION public.pricing_rules_touch_updated_at();


--
-- Name: ingestion_chunks ingestion_chunks_job_id_ingestion_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_chunks
    ADD CONSTRAINT ingestion_chunks_job_id_ingestion_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.ingestion_jobs(id);


--
-- Name: promotions promotions_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- PostgreSQL database dump complete
--

\unrestrict WPcz2V4hGf0a5zkegPdATnEJYUJJhOOVxTGKQWe1FFUvwDGbfUnyZgfgc52bCre

