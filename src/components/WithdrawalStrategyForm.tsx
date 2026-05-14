import { WithdrawalStrategySettings, AccountTypeGroup } from '../types';
import { Tooltip } from './Tooltip';

interface WithdrawalStrategyFormProps {
  strategy: WithdrawalStrategySettings;
  onChange: (strategy: WithdrawalStrategySettings) => void;
}

const GROUP_LABELS: Record<AccountTypeGroup, string> = {
  traditional: 'Traditional (Pre-tax)',
  roth: 'Roth (Tax-free)',
  taxable: 'Taxable Brokerage',
  hsa: 'HSA',
};

export function WithdrawalStrategyForm({ strategy, onChange }: WithdrawalStrategyFormProps) {
  const moveGroup = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...strategy.withdrawalOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    onChange({ ...strategy, withdrawalOrder: newOrder });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-600 pb-2">
        Withdrawal Strategy
      </h3>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={strategy.fillTaxBracket}
            onChange={e => onChange({ ...strategy, fillTaxBracket: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Fill tax bracket with traditional withdrawals
          </span>
          <Tooltip text="Before drawing from other accounts, withdraw from traditional (pre-tax) accounts up to the top of the 12% federal tax bracket. This reduces future RMDs and lifetime taxes." />
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
          Proactively uses the 12% bracket to reduce future RMDs
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Account withdrawal order
          <Tooltip text="Order in which account groups are tapped for spending needs after RMDs (and optional bracket-filling). Drag with the arrows to reorder." />
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          RMDs from traditional accounts are always taken first (required by law).
        </p>
        <ol className="space-y-1">
          {strategy.withdrawalOrder.map((group, index) => (
            <li
              key={group}
              className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2 text-sm text-gray-800 dark:text-gray-200"
            >
              <span className="w-5 text-center text-gray-400 dark:text-gray-500 font-mono text-xs select-none">
                {index + 1}
              </span>
              <span className="flex-1">{GROUP_LABELS[group]}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => moveGroup(index, 'up')}
                  disabled={index === 0}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => moveGroup(index, 'down')}
                  disabled={index === strategy.withdrawalOrder.length - 1}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
