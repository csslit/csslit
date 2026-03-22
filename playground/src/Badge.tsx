import { css } from 'csslit';
import { theme } from './theme';

export function Badge({ label }: { label: string }) {
  return (
    <span className={css`
      display: inline-block;
      padding: 4px 12px;
      background: ${theme.colors.secondary};
      color: white;
      border-radius: 999px;
      font-size: 12px;
    `}>
      {label}
    </span>
  );
}
