import { CopyButton } from './CopyButton.jsx'

export function ErrorCard({ title, code, message, detail }) {
  return (
    <div className="errcard">
      <div className="errcard-head">
        <span className="errcard-title">{title}</span>
        {code && <span className="errcard-code">{code}</span>}
        <div className="spacer" />
        {detail && <CopyButton label="copy error" title="Copy the error response" text={detail} />}
      </div>
      <div className="errcard-msg">{message || 'No error message in the response.'}</div>
      {detail && <pre className="code view sm">{detail}</pre>}
    </div>
  )
}
