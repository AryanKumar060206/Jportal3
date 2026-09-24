import { useState } from "react"
import PropTypes from "prop-types"
import { Copy, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { showErrorToast, showSuccessToast } from "@/lib/toastUtils"
import { buildSyncText, loadTokenSession } from "@/lib/portalSession"

// iOS gives Home Screen apps storage separate from Safari, so a bookmarklet sync that
// lands in Safari doesn't reach the installed app. This offers the sync text to paste there.
export default function AppSyncBanner({ onDismiss }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const text = buildSyncText(loadTokenSession())
    if (!text) {
      showErrorToast("Nothing to copy", "Connect with the bookmarklet first.")
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      showSuccessToast("Sync link copied", "Open Jportal3 from your Home Screen and tap “Paste from clipboard”.")
    } catch {
      showErrorToast("Copy failed", "Your browser blocked clipboard access. Try again.")
    }
  }

  return (
    // Solid bg-background underneath: the page body is transparent, so a translucent tint
    // alone would show the browser's default (white in light mode) through it.
    <div className="border-b border-border bg-background text-sm" role="region" aria-label="Sync to Home Screen app">
      <div className="bg-primary/10 px-4 py-3">
        <div className="container mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-foreground">
            <span className="font-medium">Using Jportal3 from your Home Screen?</span>{" "}
            <span className="text-muted-foreground">It can&apos;t see this Safari sign-in. Copy the sync link, then paste it in the app.</span>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy sync link for the app"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
              <X size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

AppSyncBanner.propTypes = {
  onDismiss: PropTypes.func.isRequired,
}
