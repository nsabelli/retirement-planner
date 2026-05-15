import { WithdrawalStrategySettings, AccountTypeGroup, RothConversionSettings } from '../types';
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

const BRACKET_OPTIONS = [
  { rate: 0.10, label: '10% bracket' },
  { rate: 0.12, label: '12% bracket' },
  { rate: 0.22, label: '22% bracket' },
  { rate: 0.24, label: '24% bracket' },
  { rate: 0.32, label: '32% bracket' },
];

const DEFAULT_CONVERSION: RothConversionSettings = {
  enabled: false,
  targetBracketRate: 0.22,
  maxAnnualConversion: 0,
};

export function WithdrawalStrategyForm({ strategy, onChange }: WithdrawalStrategyFormProps) {
  const conversion = strategy.rothConversion ?? DEFAULT_CONVERSION;

  const updateConversion = (updates: Partial<RothConversionSettings>) => {
    onChange({ ...strategy, rothConversion: { ...conversion, ...updates } });
  };

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

      <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
          Roth Conversions (Pre-RMD)
          <Tooltip text="Convert traditional (pre-tax) account balances to Roth before RMDs begin. You pay income tax on the converted amount now, but reduce future RMDs and grow the Roth balance tax-free. Requires at least one Roth account." />
        </h4>

        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={conversion.enabled}
            onChange={e => updateConversion({ enabled: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Enable Roth conversions before RMD age
          </span>
        </label>

        {conversion.enabled && (
          <div className="ml-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Fill ordinary income up to
                <Tooltip text="Convert enough traditional funds each year to bring total ordinary income (including SS, pensions, and conversions) up to the top of this bracket. Lower brackets mean less tax now but fewer conversions; higher brackets accelerate the conversion but increase current-year taxes." />
              </label>
              <select
                value={conversion.targetBracketRate}
                onChange={e => updateConversion({ targetBracketRate: parseFloat(e.target.value) })}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {BRACKET_OPTIONS.map(opt => (
                  <option key={opt.rate} value={opt.rate}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Max annual conversion (0 = no cap)
                <Tooltip text="Optional cap on how much can be converted in a single year regardless of bracket room. Enter 0 to convert up to the full bracket limit each year." />
              </label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={conversion.maxAnnualConversion}
                  onChange={e => updateConversion({ maxAnnualConversion: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md pl-6 pr-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Conversions happen each year from retirement age until RMD age (age 73 for US / 71 for Canada). The converted amount counts as ordinary income and is taxed at your marginal rate.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
