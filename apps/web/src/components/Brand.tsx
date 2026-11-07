import { Link } from 'react-router-dom';
import { PRODUCT_NAME } from '../config.js';
export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand new-brand" aria-label={`${PRODUCT_NAME} home`}>
      <svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path
          d="M4 23V9l8-5v14L4 23Zm10 5V14l8-5v14l-8 5Zm10-6V8l5-3v14l-5 3Z"
          fill="currentColor"
        />
      </svg>
      <span>
        {PRODUCT_NAME}
        <span className="brand-period">.</span>
      </span>
    </Link>
  );
}
