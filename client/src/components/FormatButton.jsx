export function FormatButton({ onClick }) {
  return (
    <button className="chip sm fmt" onClick={onClick} title="Format JSON (Shift+Alt+F in the editor)">
      Format <kbd>Shift+Alt+F</kbd>
    </button>
  )
}
