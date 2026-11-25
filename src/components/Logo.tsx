export function Logo() {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#e23b2f"
          d="M10 6h18.2L40 17.8V38a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z"
        />
        <path fill="#f0b429" d="M28.2 6 40 17.8h-9.6a2.2 2.2 0 0 1-2.2-2.2V6z" />
        <path
          fill="none"
          stroke="#f7f4ee"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M13 23.5h12M13 30h7"
        />
        <path
          fill="none"
          stroke="#ffe08a"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M25.5 26.2 31 31l-5.5 4.8"
        />
      </svg>
      <span className="brand-word">NextPDF</span>
    </div>
  )
}
