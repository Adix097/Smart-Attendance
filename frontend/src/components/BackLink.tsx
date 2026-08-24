import { Link } from 'react-router-dom';

export default function BackLink({
  to,
  label,
}: {
  to: string;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex text-sm font-semibold text-blue-700 hover:underline"
    >
      ← {label}
    </Link>
  );
}
