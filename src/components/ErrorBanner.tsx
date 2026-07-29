import { useI18n } from '../app/i18n'

interface ErrorBannerProps {
  message: string
  onDismiss?: () => void
}

/** Prominent, dismissible error message. */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  const { t } = useI18n()
  return (
    <div role="alert" className="error-banner">
      <span className="error-banner-text">{message}</span>
      {onDismiss && (
        <button type="button" className="error-banner-close" onClick={onDismiss}>
          {t('error.close')}
        </button>
      )}
    </div>
  )
}
