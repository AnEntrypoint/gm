// vendored from AnEntrypoint/gm d8f9b9ded4ee5f3a947fd3d9d3f4fce500dc713e
(function gmDevLog() {
  'use strict'
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return
  const switchedOff = () => {
    try {
      return window.localStorage.getItem('gmDevLog') === 'off'
    } catch (error) {
      return false
    }
  }
  if (switchedOff()) return

  const ENDPOINT = '/__gm-log'
  const BATCH_RECORDS = 20
  const FLUSH_MS = 1000
  const QUEUE_LIMIT = 200
  const TEXT_CHARS = 1200
  const URL_CHARS = 512
  const LEVEL_OF_CONSOLE = { log: 'info', info: 'info', debug: 'debug', warn: 'warning', error: 'error' }
  const originalFetch = window.fetch
  const queue = []
  let dropped = 0
  let timer = null

  const clip = (value, limit) => {
    const text = String(value)
    return text.length > limit ? `${text.slice(0, limit)}...` : text
  }

  const scrubUrl = (value) => {
    const bare = String(value || '')
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
      .split(/[?#]/)[0]
    return clip(bare, URL_CHARS)
  }

  const stringify = (value) => {
    if (value instanceof Error) return value.stack || String(value)
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch (error) {
        return String(value)
      }
    }
    return String(value)
  }

  const isIngest = (url) => {
    try {
      return new URL(url, location.href).pathname.indexOf(ENDPOINT) === 0
    } catch (error) {
      return false
    }
  }

  const post = (batch) => {
    const body = JSON.stringify({ records: batch })
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return
    if (typeof originalFetch === 'function') {
      originalFetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
    }
  }

  const flush = () => {
    clearTimeout(timer)
    timer = null
    if (switchedOff()) {
      queue.length = 0
      dropped = 0
      return
    }
    if (dropped > 0) {
      queue.push({ level: 'warning', text: `gm dev-log client dropped ${dropped} records while its queue was full`, url: scrubUrl(location.href), line: null, time: Date.now(), kind: 'console' })
      dropped = 0
    }
    if (queue.length === 0) return
    post(queue.splice(0, BATCH_RECORDS))
    if (queue.length > 0) timer = setTimeout(flush, 0)
  }

  const report = (level, kind, text, url, line) => {
    if (queue.length >= QUEUE_LIMIT) {
      dropped += 1
      return
    }
    queue.push({
      level,
      text: clip(text, TEXT_CHARS),
      url: scrubUrl(url || location.href),
      line: Number.isInteger(line) ? line : null,
      time: Date.now(),
      kind,
    })
    if (queue.length >= BATCH_RECORDS) flush()
    else if (timer === null) timer = setTimeout(flush, FLUSH_MS)
  }

  const reportNetwork = (method, url, detail) => {
    report('warning', 'network', `${method} ${scrubUrl(url)} failed: ${detail}`, url, null)
  }

  for (const name of Object.keys(LEVEL_OF_CONSOLE)) {
    const original = console[name]
    if (typeof original !== 'function') continue
    console[name] = function (...values) {
      try {
        report(LEVEL_OF_CONSOLE[name], 'console', values.map(stringify).join(' '), location.href, null)
      } catch (error) {}
      return original.apply(this, values)
    }
  }

  const previousOnError = window.onerror
  window.onerror = function (message, source, line, column, error) {
    report('error', 'exception', error && error.stack ? String(error.stack) : String(message), source, line)
    if (typeof previousOnError === 'function') return previousOnError.apply(this, arguments)
    return false
  }

  window.addEventListener('unhandledrejection', (event) => {
    report('error', 'exception', `unhandledrejection: ${stringify(event.reason)}`, location.href, null)
  })

  window.addEventListener('error', (event) => {
    const target = event.target
    if (!target || target === window || !target.tagName) return
    const source = target.src || target.href || ''
    report('error', 'resource', `failed to load ${target.tagName.toLowerCase()}${source ? ` ${scrubUrl(source)}` : ''}`, source, null)
  }, true)

  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
      const pending = originalFetch.apply(this, arguments)
      if (!isIngest(url)) {
        pending.then(
          (response) => {
            if (response.status >= 400) reportNetwork(method, url, `HTTP ${response.status}`)
          },
          (error) => reportNetwork(method, url, error && error.message ? error.message : String(error)),
        )
      }
      return pending
    }
  }

  if (typeof XMLHttpRequest === 'function') {
    const xhrOpen = XMLHttpRequest.prototype.open
    const xhrSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url) {
      this.gmDevLogRequest = { method: String(method).toUpperCase(), url: String(url) }
      return xhrOpen.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function () {
      const xhr = this
      const request = this.gmDevLogRequest
      if (request && !isIngest(request.url)) {
        let aborted = false
        xhr.addEventListener('abort', () => {
          aborted = true
        })
        xhr.addEventListener('loadend', () => {
          if (aborted) return
          if (xhr.status >= 400) reportNetwork(request.method, request.url, `HTTP ${xhr.status}`)
          else if (xhr.status === 0) reportNetwork(request.method, request.url, 'network error')
        })
      }
      return xhrSend.apply(this, arguments)
    }
  }

  window.addEventListener('pagehide', flush)
})()
