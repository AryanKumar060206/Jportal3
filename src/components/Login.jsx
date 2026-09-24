import { useState, useEffect, useRef, useMemo } from "react"
import PropTypes from "prop-types"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { WebPortalSession } from "https://cdn.jsdelivr.net/npm/jsjiit@0.0.28/dist/jsjiit.esm.js"
import { showErrorToast, showSuccessToast, showLoadingToast, updateToastError, updateToastSuccess } from '@/lib/toastUtils'
import { UtensilsCrossed, Calendar, Heart, Laugh, Smartphone, ExternalLink, Bookmark, Copy, Check, Link2, Laptop, Apple, ClipboardPaste } from "lucide-react"
import InstallPWA from './InstallPWA'
import MessMenu from "./MessMenu"
import ThemeBtn from "./ui/ThemeBtn"
import { ArtificialWebPortal } from "./scripts/artificialW"
import { hasCachedProfile, hasAnyAttendance, hasAnyGrades } from '@/components/scripts/cache'
import {
  WEBPORTAL_URL,
  buildSession,
  getBookmarkletHref,
  getConsoleSnippet,
  isIOSDevice,
  isStandaloneApp,
  isTokenExpired,
  loadTokenSession,
  parseHandoff,
  repairFromProfile,
  saveTokenSession,
  tokenExpiry,
} from '@/lib/portalSession'

const DEVICE_STEPS = {
  desktop: [
    "Drag the “Sync to Jportal3” button below onto your bookmarks bar (one time only).",
    "Open WebPortal and sign in with your college Google account.",
    "Click the “Sync to Jportal3” bookmark while you're on WebPortal. You'll be brought straight back here, signed in.",
  ],
  android: [
    "Tap “Copy bookmarklet”, then bookmark any page in Chrome, edit that bookmark, name it JP3 and paste the copied text as its URL.",
    "Open WebPortal and sign in with your college Google account.",
    "On WebPortal, tap the address bar, type JP3 and tap the suggestion with the star ☆ icon. You'll come back here, signed in. Don't open it from the Bookmarks menu: Chrome on Android silently ignores bookmarklets opened there.",
  ],
  ios: [
    "Tap “Copy bookmarklet”, then in Safari bookmark any page, edit the bookmark, name it JP3 and paste the copied text as its address.",
    "Open WebPortal in Safari and sign in with your college Google account.",
    "Open Bookmarks and tap JP3 while you're on WebPortal. You'll come back to Jportal3 in Safari, signed in. Using the Home Screen app? Tap “Copy sync link for the app” there, then paste it in the app.",
  ],
  // iOS Home Screen app: storage is separate from Safari, so the sync is carried over by paste.
  iosApp: [
    "Open Safari (not this app), go to WebPortal and sign in with your college Google account. Set up the JP3 bookmark first if you haven't: tap “Copy bookmarklet” below.",
    "Tap the JP3 bookmark. Jportal3 opens in Safari; tap “Copy sync link for the app” at the top.",
    "Come back to this app and tap “Paste from clipboard” below.",
  ],
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function detectDevice() {
  if (isIOSDevice()) return "ios"
  if (typeof navigator !== "undefined" && /Android/.test(navigator.userAgent)) return "android"
  return "desktop"
}

export default function Login({ onLoginSuccess, w }) {
  const [status, setStatus] = useState({ isLoading: false, error: null })
  const [hasCache, setHasCache] = useState(false)
  const [device, setDevice] = useState(detectDevice)
  const [pasted, setPasted] = useState("")
  const [copied, setCopied] = useState(null)
  const [savedSession, setSavedSession] = useState(null)
  const bookmarkletRef = useRef(null)
  const inIOSApp = isIOSDevice() && isStandaloneApp()
  const steps = device === "ios" && inIOSApp ? DEVICE_STEPS.iosApp : DEVICE_STEPS[device]

  const appOrigin = typeof window !== "undefined" ? window.location.origin : ""
  const bookmarkletHref = useMemo(() => getBookmarkletHref(appOrigin), [appOrigin])

  useEffect(() => {
    setHasCache(hasCachedProfile() || hasAnyAttendance() || hasAnyGrades())
    const stored = loadTokenSession()
    if (stored && !isTokenExpired(stored.token)) setSavedSession(stored)
  }, [])

  // React warns on javascript: hrefs, so the bookmarklet href is set directly on the DOM node.
  useEffect(() => {
    if (bookmarkletRef.current) bookmarkletRef.current.setAttribute("href", bookmarkletHref)
  }, [bookmarkletHref, device])

  const flashCopied = (key) => {
    setCopied(key)
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 2500)
  }

  const handleCopy = async (key, text, label) => {
    if (await copyText(text)) {
      flashCopied(key)
      showSuccessToast(`${label} copied`)
    } else {
      showErrorToast("Copy failed", "Please copy it manually.")
    }
  }

  const connectWith = async (data) => {
    if (!data?.token) {
      setStatus({ isLoading: false, error: "Couldn't find a WebPortal token in that text. Re-run the bookmarklet or console snippet on WebPortal and try again." })
      return
    }
    if (isTokenExpired(data.token)) {
      setStatus({ isLoading: false, error: "That token has already expired. Sign in on WebPortal again, then re-run the bookmarklet." })
      return
    }

    const toastId = showLoadingToast("Connecting to WebPortal...", "connect-toast")
    setStatus({ isLoading: true, error: null })
    const saved = saveTokenSession(data)
    try {
      w.session = buildSession(WebPortalSession, saved)
      await repairFromProfile(w)
      setStatus({ isLoading: false, error: null })
      setPasted("")
      updateToastSuccess(toastId, "Connected", `Welcome${w.session.name ? `, ${w.session.name}` : ""}!`)
      onLoginSuccess(w)
    } catch (error) {
      console.error("Connecting with token failed:", error)
      const rejected = !loadTokenSession()
      w.session = null
      const message = rejected
        ? "WebPortal rejected this token. Sign in on WebPortal again and re-run the bookmarklet."
        : "Couldn't reach JIIT WebPortal right now. Your sync is saved, so try again in a moment."
      if (!rejected) setSavedSession(saved)
      setStatus({ isLoading: false, error: message })
      updateToastError(toastId, "Connection failed", message)
    }
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setPasted(text)
      connectWith(parseHandoff(text))
    } catch {
      showErrorToast("Can't read clipboard", "Long-press the box below and choose Paste instead.")
    }
  }

  const handlePasteConnect = (e) => {
    e.preventDefault()
    connectWith(parseHandoff(pasted))
  }

  const handleOfflineMode = () => {
    const cached = hasCachedProfile() || hasAnyAttendance() || hasAnyGrades()
    if (!cached) {
      showErrorToast("Offline unavailable", "No cached data available. Connect online first to use offline mode.")
      setStatus((prev) => ({ ...prev, error: "No cached data available. Connect online first to use offline mode." }))
      return
    }
    showSuccessToast("Offline mode enabled", "Using cached data for offline access.")
    onLoginSuccess(new ArtificialWebPortal())
  }

  const savedExpiry = savedSession ? tokenExpiry(savedSession.token) : null

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <header className="py-3 px-4 border-b border-border" style={{ paddingTop: "calc(0.75rem + var(--header-safe-top))" }}>
        <div className="container mx-auto flex items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">Modern JIIT WebKiosk</h1>
          <ThemeBtn />
        </div>
      </header>

      <main className="flex-1 min-h-0 container mx-auto px-4 pt-2 pb-2 flex flex-col items-center justify-start gap-0">
        <div className="w-full flex flex-col items-center justify-center gap-0 md:flex-row md:items-stretch md:justify-center md:gap-6 xl:max-w-6xl">
          <div className="hidden md:flex md:w-[320px] flex-col items-center gap-6 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-xl">
            <img src="https://cdn.jsdelivr.net/gh/J2V-k/jportal-vhost@main/public/pwa-icons/wheel.svg" alt="Jportal3 Logo" className="w-20 h-20 rounded-2xl shadow-lg" />
            <div className="text-center space-y-2">
              <h2 className="text-lg font-semibold text-card-foreground">Jportal3</h2>
            </div>
            <div className="w-full">
              <InstallPWA />
            </div>
          </div>
          <div className="w-full flex justify-center mb-0 lg:hidden">
            <div className="w-full max-w-[320px]">
              <InstallPWA />
            </div>
          </div>
          <div className="w-full min-h-0 md:flex-1">
            <div className="bg-card backdrop-blur-sm rounded-xl shadow-xl border border-border min-h-0 overflow-hidden">
              <div className="flex flex-col gap-3 p-4 md:p-5 max-h-[calc(100vh-96px)] overflow-y-auto">
                <div className="space-y-3">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-card-foreground">Connect to WebPortal</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      WebPortal now uses Google sign-in. Sign in there with your college account, then use the
                      Jportal3 bookmarklet to bring your session here. Your password never touches this app.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/80 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {hasCache ? 'Cached data is available for offline use.' : 'Connect to refresh your data.'}
                    </p>
                  </div>
                </div>

                {status.error && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{status.error}</AlertDescription>
                  </Alert>
                )}

                {savedSession && (
                  <Button
                    onClick={() => connectWith(savedSession)}
                    disabled={status.isLoading}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {status.isLoading ? "Connecting..." : `Continue as ${savedSession.enroll || "saved session"}`}
                    {savedExpiry && !status.isLoading && (
                      <span className="ml-2 text-xs opacity-80">(valid until {savedExpiry.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})</span>
                    )}
                  </Button>
                )}

                <div className="flex gap-1 rounded-lg bg-muted/60 p-1 text-sm" role="tablist" aria-label="Your device">
                  {[
                    { key: "desktop", label: "Laptop / PC", Icon: Laptop },
                    { key: "android", label: "Android", Icon: Smartphone },
                    { key: "ios", label: "iPhone / iPad", Icon: Apple },
                  ].map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={device === key}
                      onClick={() => setDevice(key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${device === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </div>

                <ol className="space-y-2 text-sm">
                  {steps.map((step, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{idx + 1}</span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-col sm:flex-row gap-2">
                  {device === "desktop" ? (
                    <a
                      ref={bookmarkletRef}
                      onClick={(e) => {
                        e.preventDefault()
                        showErrorToast("Drag, don't click", "Drag this button onto your bookmarks bar, then click it while you're on WebPortal.")
                      }}
                      draggable
                      title="Drag me to your bookmarks bar"
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/60 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary cursor-grab"
                    >
                      <Bookmark size={16} /> Sync to Jportal3
                    </a>
                  ) : (
                    <Button type="button" variant="outline" className="flex-1" onClick={() => handleCopy("bookmarklet", bookmarkletHref, "Bookmarklet")}>
                      {copied === "bookmarklet" ? <Check size={16} /> : <Bookmark size={16} />} Copy bookmarklet
                    </Button>
                  )}
                  {!inIOSApp && (
                    <Button type="button" variant="outline" className="flex-1" onClick={() => window.open(WEBPORTAL_URL, "_blank", "noopener")}>
                      <ExternalLink size={16} /> Open WebPortal
                    </Button>
                  )}
                </div>

                {inIOSApp && (
                  <Button type="button" className="w-full" disabled={status.isLoading} onClick={handlePasteFromClipboard}>
                    <ClipboardPaste size={16} /> Paste from clipboard
                  </Button>
                )}

                <details className="rounded-lg border border-border/70 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-foreground">
                    {inIOSApp ? "Paste the sync link manually" : "Bookmarklet not working? Paste a sync link instead"}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-muted-foreground">
                      On WebPortal (after signing in) open the browser console (Ctrl+Shift+J / Cmd+Option+J), paste the
                      snippet and press Enter. It copies a sync link to your clipboard. Paste that below.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleCopy("snippet", getConsoleSnippet(), "Console snippet")}>
                      {copied === "snippet" ? <Check size={14} /> : <Copy size={14} />} Copy console snippet
                    </Button>
                    <form onSubmit={handlePasteConnect} className="space-y-2">
                      <label htmlFor="sync-link" className="sr-only">Sync link</label>
                      <textarea
                        id="sync-link"
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder="token=...&enroll=..."
                        rows={3}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" className="flex-1" disabled={status.isLoading} onClick={handlePasteFromClipboard}>
                          <ClipboardPaste size={16} /> Paste
                        </Button>
                        <Button type="submit" className="flex-1" disabled={status.isLoading || !pasted.trim()}>
                          <Link2 size={16} /> {status.isLoading ? "Connecting..." : "Connect"}
                        </Button>
                      </div>
                    </form>
                  </div>
                </details>

                <div className="mt-2 space-y-3">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="px-2 text-muted-foreground bg-background">Or continue without connecting</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row justify-center gap-2">
                    <button
                      onClick={handleOfflineMode}
                      disabled={status.isLoading || !hasCache}
                      className={`flex items-center justify-center px-5 py-2 rounded-lg text-sm font-medium gap-2 transition-colors ${
                        hasCache
                          ? "bg-orange-600/20 dark:bg-orange-100 border border-orange-500/30 dark:border-orange-300 text-foreground hover:bg-orange-700/40 dark:hover:bg-orange-50 hover:text-foreground"
                          : "bg-muted/80 border border-border text-muted-foreground cursor-not-allowed opacity-70"
                      }`}
                      title={hasCache ? "Continue with cached data" : "Connect once to enable offline mode"}
                    >
                      <Smartphone size={18} /> Offline Mode
                    </button>
                    <MessMenu>
                      <button className="flex items-center justify-center px-6 py-2 bg-green-600/20 dark:bg-green-100 border border-green-500/30 dark:border-green-300 text-green-400 dark:text-green-700 hover:bg-green-700/40 dark:hover:bg-green-50 hover:text-green-200 dark:hover:text-green-600 transition-colors rounded-lg text-sm font-medium gap-2">
                        <UtensilsCrossed size={18} /> Mess Menu
                      </button>
                    </MessMenu>
                    <a
                      href="#/academic-calendar"
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.href = '#/academic-calendar';
                      }}
                      className="flex items-center justify-center px-4 py-2 bg-blue-600/20 dark:bg-blue-100 border border-blue-500/30 dark:border-blue-300 text-blue-400 dark:text-blue-700 hover:bg-blue-700/40 dark:hover:bg-blue-50 hover:text-blue-200 dark:hover:text-blue-600 transition-colors rounded-lg text-sm font-medium gap-2"
                    >
                      <Calendar size={18} /> Academic Calendar
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-3 text-center text-muted-foreground text-xs sm:text-sm">
        <p className="flex flex-wrap items-center justify-center gap-1">
          Created with <Heart className="w-4 h-4 text-red-400" /> for JIIT students only
        </p>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-1">
          Not liable for attendance-related emotional damage <Laugh className="w-4 h-4" />
        </p>
      </footer>
    </div>
  )
}

Login.propTypes = {
  onLoginSuccess: PropTypes.func.isRequired,
  w: PropTypes.shape({
    session: PropTypes.shape({ name: PropTypes.string }),
  }).isRequired,
}
