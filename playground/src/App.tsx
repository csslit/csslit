import { theme, multiply } from './theme';
import { css } from 'csslit';
import { Badge } from './Badge';

export default function App() {
  return (
    <div className={css`
      display: flex;
      flex-direction: column;
      gap: ${multiply(theme.gap, 4)}px;
      padding: 20px;
      background-color: #f0f0f0;
      border: 2px solid ${theme.colors.secondary};
      border-radius: 8px;
    `}>
      <h1 className={css`color: ${theme.colors.primary};`}>Hello Compile-Time CSS!</h1>
      <button className={css`
        padding: 10px 20px;
        background: ${theme.colors.primary};
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        &:hover {
          background: ${theme.colors.secondary};
        }
      `}>
        Click Me
      </button>
      <Badge label="New" />
    </div>
  );
}
