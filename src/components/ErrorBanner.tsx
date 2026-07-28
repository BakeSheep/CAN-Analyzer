interface ErrorBannerProps {
  message: string
  onDismiss?: () => void
}

/** Prominent, dismissible error message. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div role="alert" className="error-banner">
      <span className="error-banner-text">{message}</span>
      {onDismiss && (
        <button type="button" className="error-banner-close" onClick={onDismiss}>
          关闭
        </button>
      )}
    </div>
  )
}
