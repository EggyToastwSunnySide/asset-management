/**
 * Thin fetch wrapper that feature `api/` modules build on. The base URL,
 * headers and error handling live only here.
 *
 * Authentication is cookie-backed. Cookies stay same-origin, while the CSRF
 * token returned with the current session is kept only in memory and attached
 * to unsafe requests.
 */

import { API_BASE_URL } from './config'

/** Per-field messages from DTO validation (ADR-0005), keyed by request field name. */
export type FieldErrors = Record<string, string>

/** Error body every backend `/api` endpoint returns. */
interface ErrorEnvelope {
  error: { code: string; message: string; fields?: FieldErrors }
}

export class ApiError extends Error {
  status: number
  /** Machine-readable code, e.g. `VALIDATION_FAILED`, `INVALID_CREDENTIALS`. */
  code: string
  fields?: FieldErrors

  constructor(message: string, status: number, code: string, fields?: FieldErrors) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/** Offset/limit page returned by list endpoints (ADR-0003). */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

type QueryValue = string | number | boolean | null | undefined

/** An array value repeats its key (`type=A&type=B`), which the API reads as "any of". */
export type QueryParams = Record<string, QueryValue | QueryValue[]>

export interface ApiRequestOptions {
  /** A 401 is part of this request's normal contract (sign-in and session bootstrap). */
  suppressUnauthorizedEvent?: boolean
}

export interface UnexpectedUnauthorizedEvent {
  type: 'unexpected-unauthorized'
  generation: number
}

type AuthEventListener = (event: UnexpectedUnauthorizedEvent) => void

let csrfToken: string | null = null
let authGeneration = 0
let lastNotifiedUnauthorizedGeneration: number | null = null
const authEventListeners = new Set<AuthEventListener>()

/** The successful start of an identity invalidates every older in-flight request. */
export function establishAuthGeneration(token: string) {
  authGeneration += 1
  csrfToken = token
  lastNotifiedUnauthorizedGeneration = null
}

/** Capture ownership before an async session request starts. */
export function captureAuthGeneration() {
  return authGeneration
}

/** Refresh the token only if the request still belongs to the current identity. */
export function setCsrfTokenForGeneration(token: string | null, generation: number) {
  if (generation !== authGeneration) return false
  csrfToken = token
  return true
}

/** End the current generation so a late response cannot affect the next identity. */
export function clearAuthTransportState() {
  authGeneration += 1
  csrfToken = null
  lastNotifiedUnauthorizedGeneration = null
}

export function subscribeToAuthEvents(listener: AuthEventListener) {
  authEventListeners.add(listener)
  return () => {
    authEventListeners.delete(listener)
  }
}

function emitUnexpectedUnauthorized(requestGeneration: number) {
  if (requestGeneration !== authGeneration) return
  if (lastNotifiedUnauthorizedGeneration === requestGeneration) return

  lastNotifiedUnauthorizedGeneration = requestGeneration
  const event: UnexpectedUnauthorizedEvent = {
    type: 'unexpected-unauthorized',
    generation: requestGeneration,
  }
  for (const listener of authEventListeners) listener(event)
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${API_BASE_URL}${path}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      // Drop empty filters so `?type=&status=` never reaches the server.
      if (value === undefined || value === null || value === '') continue
      params.append(key, String(value))
    }
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ErrorEnvelope).error?.message === 'string'
  )
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null)
  if (isErrorEnvelope(body)) {
    const { message, code, fields } = body.error
    return new ApiError(message, res.status, code, fields)
  }
  return new ApiError(`Request to ${path} failed`, res.status, 'HTTP_ERROR')
}

interface SendOptions extends RequestInit, ApiRequestOptions {
  query?: QueryParams
}

function isUnsafeMethod(method: string | undefined) {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase())
}

async function send(path: string, init: SendOptions = {}) {
  const { query, headers: rawHeaders, suppressUnauthorizedEvent, ...rest } = init
  const requestGeneration = authGeneration
  const headers = new Headers(rawHeaders)
  const hasBody = rest.body !== undefined

  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (hasBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (isUnsafeMethod(rest.method) && csrfToken && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      ...rest,
      credentials: 'same-origin',
      headers,
    })
  } catch {
    // DNS failure, offline, proxy target down in dev, CORS, …
    throw new ApiError('Could not reach the server', 0, 'NETWORK_ERROR')
  }

  if (!res.ok) {
    if (res.status === 401 && !suppressUnauthorizedEvent) {
      emitUnexpectedUnauthorized(requestGeneration)
    }
    throw await toApiError(res, path)
  }
  return res
}

async function request<T>(path: string, init?: SendOptions): Promise<T> {
  const res = await send(path, init)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function filenameFrom(res: Response, fallback: string): string {
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return match ? decodeURIComponent(match[1]) : fallback
}

export const apiClient = {
  get: <T>(path: string, query?: QueryParams, options?: ApiRequestOptions) =>
    request<T>(path, { query, ...options }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      ...options,
    }),
  put: <T>(path: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body), ...options }),
  delete: <T = void>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { method: 'DELETE', ...options }),

  /**
   * POSTs a JSON body and returns the binary response — for the synchronous
   * Excel export (ADR-0007). The filename comes from `Content-Disposition`.
   */
  download: async (path: string, body: unknown, fallbackName: string) => {
    const res = await send(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Accept: 'application/octet-stream' },
    })
    return {
      blob: await res.blob(),
      filename: filenameFrom(res, fallbackName),
      headers: res.headers,
    }
  },
}

/**
 * One line of user-facing text for any error a query or mutation throws.
 * Field messages are appended so nothing the server said is lost when the
 * caller has no per-field place to show them.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.entries(error.fields ?? {})
      .filter(([, message]) => message !== error.message)
      .map(([field, message]) => `${field}: ${message}`)
    return fields.length ? `${error.message} — ${fields.join('; ')}` : error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}
