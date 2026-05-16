import { Assumptions, WithdrawalMode } from '../types';
import { NumberInput } from './NumberInput';
import { Tooltip } from './Tooltip';

interface AssumptionsFormProps {
  assumptions: Assumptions;
  onChange: (assumptions: Assumptions) => void;
}

const inputClassName = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";

export function AssumptionsForm({ assumptions, onChange }: AssumptionsFormProps) {
  const mode: WithdrawalMode = assumptions.withdrawalMode ?? 'swr';

  const handleChange = (field: keyof Assumptions, value: number | string) => {
    onChange({ ...assumptions, [field]: value });
  };

  const handleModeChange = (newMode: WithdrawalMode) => {
    onChange({ ...assumptions, withdrawalMode: newMode });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-600 pb-2">Economic Assumptions</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Inflation Rate (%)
            <Tooltip text="Expected annual inflation rate" />
          </label>
          <NumberInput
            value={assumptions.inflationRate}
            onChange={(val) => handleChange('inflationRate', val)}
            min={0}
            max={10}
            isPercentage
            decimals={1}
            defaultValue={0.03}
            className={inputClassName}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Historical average: ~3%</p>
        </div>

        {/* Withdrawal target mode toggle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Withdrawal Target Method
            <Tooltip text="Choose how to set your retirement spending target" />
          </label>
          <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => handleModeChange('swr')}
              className={`flex-1 px-3 py-2 font-medium transition-colors ${
                mode === 'swr'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Safe Withdrawal Rate
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('target_spending')}
              className={`flex-1 px-3 py-2 font-medium transition-colors border-l border-gray-300 dark:border-gray-600 ${
                mode === 'target_spending'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Target Monthly Spending
            </button>
          </div>
        </div>

        {mode === 'swr' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Safe Withdrawal Rate (%)
              <Tooltip text="Percentage of portfolio to withdraw annually in retirement" />
            </label>
            <NumberInput
              value={assumptions.safeWithdrawalRate}
              onChange={(val) => handleChange('safeWithdrawalRate', val)}
              min={1}
              max={10}
              isPercentage
              decimals={1}
              defaultValue={0.04}
              className={inputClassName}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Traditional rule: 4%</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Target Monthly Spending (USD)
              <Tooltip text="Total after-tax monthly income you want in retirement, in today's dollars" />
            </label>
            <NumberInput
              value={assumptions.targetMonthlySpending ?? 5000}
              onChange={(val) => handleChange('targetMonthlySpending', val)}
              min={0}
              max={100000}
              isPercentage={false}
              decimals={0}
              defaultValue={5000}
              className={inputClassName}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">After-tax target in today's dollars — adjusted for inflation each year</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Retirement Return Rate (%)
            <Tooltip text="Expected annual return during retirement (typically more conservative)" />
          </label>
          <NumberInput
            value={assumptions.retirementReturnRate}
            onChange={(val) => handleChange('retirementReturnRate', val)}
            min={0}
            max={15}
            isPercentage
            decimals={1}
            defaultValue={0.05}
            className={inputClassName}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Conservative assumption: 5%</p>
        </div>
      </div>
    </div>
  );
}
