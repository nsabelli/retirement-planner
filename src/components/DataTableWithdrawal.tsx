import { useState } from 'react';
import { Account, RetirementResult, IncomeStream, IncomeTaxTreatment, getTaxTreatment } from '../types';
import { CHART_COLORS } from '../utils/constants';

interface DataTableWithdrawalProps {
  accounts: Account[];
  result: RetirementResult;
  incomeStreams?: IncomeStream[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  if (!isFinite(value) || isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatBracketRange(min: number, max: number): string {
  const lo = formatCurrency(min);
  return max === Infinity ? `${lo}+` : `${lo} – ${formatCurrency(max)}`;
}

type ViewMode = 'combined' | 'income' | 'withdrawals' | 'balances' | 'taxes' | 'incomeStreams';

export function DataTableWithdrawal({ accounts, result, incomeStreams = [] }: DataTableWithdrawalProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [expandedPenaltyRows, setExpandedPenaltyRows] = useState<Set<number>>(new Set());

  const togglePenaltyRow = (age: number) => {
    setExpandedPenaltyRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(age)) {
        newSet.delete(age);
      } else {
        newSet.add(age);
      }
      return newSet;
    });
  };

  if (!result.yearlyWithdrawals.length) return null;

  const hasRothConversion = result.yearlyWithdrawals.some(y => y.rothConversionAmount > 0);
  const hasGovBenefits = result.yearlyWithdrawals.some(y => y.governmentBenefitIncome > 0);

  // Get color class based on account tax treatment
  const getColorClass = (accountType: Account['type']): string => {
    const treatment = getTaxTreatment(accountType);
    switch (treatment) {
      case 'pretax': return 'text-blue-600 dark:text-blue-400';
      case 'roth': return 'text-green-600 dark:text-green-400';
      case 'taxable': return 'text-amber-600 dark:text-amber-400';
      case 'hsa': return 'text-purple-600 dark:text-purple-400';
    }
  };

  // Get inline color for income stream tax treatment
  const getStreamColor = (taxTreatment: IncomeTaxTreatment): string => {
    switch (taxTreatment) {
      case 'social_security': return CHART_COLORS.socialSecurity;
      case 'fully_taxable': return CHART_COLORS.pension;
      case 'other_income': return CHART_COLORS.otherIncome;
      case 'tax_free': return CHART_COLORS.taxFreeIncome;
    }
  };

  const tabs: { id: ViewMode; label: string }[] = [
    { id: 'combined', label: 'All Columns' },
    { id: 'income', label: 'Income & Spending' },
    { id: 'withdrawals', label: 'Withdrawals by Account' },
    { id: 'balances', label: 'Remaining Balances' },
    { id: 'taxes', label: 'Tax Details' },
    { id: 'incomeStreams', label: 'Income Streams' },
  ];

  const sum = (fn: (y: RetirementResult['yearlyWithdrawals'][number]) => number) =>
    result.yearlyWithdrawals.reduce((acc, y) => acc + fn(y), 0);

  const totalGrossIncome = sum(y => y.grossIncome);
  const totalTaxableIncome = sum(y => y.taxableIncome);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="font-medium text-gray-900 dark:text-white">Year-by-Year Data</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4">
          {/* View Mode Tabs */}
          <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                  viewMode === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            {viewMode === 'combined' && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Target Spending</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-900 dark:text-white">Withdrawals</th>
                    <th className="text-right py-2 px-2 font-medium text-blue-600 dark:text-blue-400">RMD</th>
                    {hasRothConversion && (
                      <th className="text-right py-2 px-2 font-medium text-emerald-600 dark:text-emerald-400">Roth Conv.</th>
                    )}
                    <th className="text-right py-2 px-2 font-medium" style={{ color: CHART_COLORS.retirementIncome }}>Retirement Income</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Gross Income</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Taxable Income</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Federal Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-orange-600 dark:text-orange-400">State Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-500">Penalties</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Total Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Tax Bracket</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Eff. Rate</th>
                    <th className="text-right py-2 px-2 font-medium text-teal-600 dark:text-teal-400">After-Tax Spendable</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Remaining Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => {
                    const effectiveRate = yearData.grossIncome > 0 ? yearData.totalTax / yearData.grossIncome : 0;
                    const retirementIncome = yearData.governmentBenefitIncome + yearData.incomeStreamIncome;
                    return (
                      <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                        <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.targetSpending)}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{formatCurrency(yearData.totalWithdrawal)}</td>
                        <td className="py-2 px-2 text-right font-mono text-blue-600 dark:text-blue-400">{yearData.rmdAmount > 0 ? formatCurrency(yearData.rmdAmount) : '-'}</td>
                        {hasRothConversion && (
                          <td className="py-2 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{yearData.rothConversionAmount > 0 ? formatCurrency(yearData.rothConversionAmount) : '-'}</td>
                        )}
                        <td className="py-2 px-2 text-right font-mono" style={{ color: CHART_COLORS.retirementIncome }}>{retirementIncome > 0 ? formatCurrency(retirementIncome) : '-'}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{formatCurrency(yearData.grossIncome)}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.taxableIncome)}</td>
                        <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(yearData.federalTax)}</td>
                        <td className="py-2 px-2 text-right font-mono text-orange-600 dark:text-orange-400">{formatCurrency(yearData.stateTax)}</td>
                        <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-500">{yearData.totalPenalties > 0 ? formatCurrency(yearData.totalPenalties) : '-'}</td>
                        <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(yearData.totalTax)}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-700 dark:text-gray-300">
                          <div>{(yearData.taxBracket.rate * 100).toFixed(0)}%</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">{formatBracketRange(yearData.taxBracket.min, yearData.taxBracket.max)}</div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatPercent(effectiveRate)}</td>
                        <td className="py-2 px-2 text-right font-mono text-teal-600 dark:text-teal-400">{formatCurrency(yearData.afterTaxIncome)}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.totalRemainingBalance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-900">Lifetime Total</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">{formatCurrency(sum(y => y.totalWithdrawal))}</td>
                    <td className="py-2 px-2 text-right font-mono text-blue-600 dark:text-blue-400">-</td>
                    {hasRothConversion && (
                      <td className="py-2 px-2 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(sum(y => y.rothConversionAmount))}</td>
                    )}
                    <td className="py-2 px-2 text-right font-mono font-medium" style={{ color: CHART_COLORS.retirementIncome }}>{formatCurrency(sum(y => y.governmentBenefitIncome + y.incomeStreamIncome))}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">{formatCurrency(totalGrossIncome)}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-600 dark:text-gray-400">{formatCurrency(totalTaxableIncome)}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-400">{formatCurrency(sum(y => y.federalTax))}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-orange-600 dark:text-orange-400">{formatCurrency(sum(y => y.stateTax))}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-500">{formatCurrency(sum(y => y.totalPenalties))}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-400">{formatCurrency(result.lifetimeTaxesPaid)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatPercent(totalGrossIncome > 0 ? result.lifetimeTaxesPaid / totalGrossIncome : 0)}</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-teal-600 dark:text-teal-400">{formatCurrency(sum(y => y.afterTaxIncome))}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">-</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {viewMode === 'income' && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Target Spending</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Withdrawals</th>
                    <th className="text-right py-2 px-2 font-medium" style={{ color: CHART_COLORS.retirementIncome }}>Retirement Income</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Gross Income</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Taxable Income</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Total Taxes</th>
                    <th className="text-right py-2 px-2 font-medium text-teal-600 dark:text-teal-400">After-Tax Spendable</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => (
                    <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                      <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.targetSpending)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{formatCurrency(yearData.totalWithdrawal)}</td>
                      <td className="py-2 px-2 text-right font-mono" style={{ color: CHART_COLORS.retirementIncome }}>
                        {(yearData.governmentBenefitIncome + yearData.incomeStreamIncome) > 0 ? formatCurrency(yearData.governmentBenefitIncome + yearData.incomeStreamIncome) : '-'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{formatCurrency(yearData.grossIncome)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.taxableIncome)}</td>
                      <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(yearData.totalTax)}</td>
                      <td className="py-2 px-2 text-right font-mono text-teal-600 dark:text-teal-400">{formatCurrency(yearData.afterTaxIncome)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-900">Lifetime Total</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                      {formatCurrency(sum(y => y.totalWithdrawal))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium" style={{ color: CHART_COLORS.retirementIncome }}>
                      {formatCurrency(sum(y => y.governmentBenefitIncome + y.incomeStreamIncome))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                      {formatCurrency(totalGrossIncome)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-600 dark:text-gray-400">
                      {formatCurrency(totalTaxableIncome)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-400">
                      {formatCurrency(result.lifetimeTaxesPaid)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-teal-600 dark:text-teal-400">
                      {formatCurrency(sum(y => y.afterTaxIncome))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {viewMode === 'withdrawals' && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    <th className="text-right py-2 px-2 font-medium text-blue-600 dark:text-blue-400">RMD</th>
                    {hasRothConversion && (
                      <th className="text-right py-2 px-2 font-medium text-emerald-600 dark:text-emerald-400">Roth Conv.</th>
                    )}
                    {accounts.map(acc => (
                      <th key={acc.id} className={`text-right py-2 px-2 font-medium ${getColorClass(acc.type)}`}>
                        {acc.name}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => (
                    <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                      <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                      <td className="py-2 px-2 text-right font-mono text-blue-600 dark:text-blue-400">
                        {yearData.rmdAmount > 0 ? formatCurrency(yearData.rmdAmount) : '-'}
                      </td>
                      {hasRothConversion && (
                        <td className="py-2 px-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {yearData.rothConversionAmount > 0 ? formatCurrency(yearData.rothConversionAmount) : '-'}
                        </td>
                      )}
                      {accounts.map(acc => {
                        const spending = yearData.withdrawals[acc.id] || 0;
                        const conversion = yearData.conversionByAccount[acc.id] || 0;
                        const total = spending + conversion;
                        return (
                          <td key={acc.id} className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">
                            {total > 0 ? formatCurrency(total) : '-'}
                          </td>
                        );
                      })}
                      <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                        {formatCurrency(yearData.totalWithdrawal + yearData.rothConversionAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-900">Lifetime Total</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono text-blue-600 dark:text-blue-400">-</td>
                    {hasRothConversion && (
                      <td className="py-2 px-2 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(sum(y => y.rothConversionAmount))}
                      </td>
                    )}
                    {accounts.map(acc => (
                      <td key={acc.id} className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">
                        {formatCurrency(sum(y => (y.withdrawals[acc.id] || 0) + (y.conversionByAccount[acc.id] || 0)))}
                      </td>
                    ))}
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                      {formatCurrency(sum(y => y.totalWithdrawal + y.rothConversionAmount))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {viewMode === 'balances' && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    {accounts.map(acc => (
                      <th key={acc.id} className={`text-right py-2 px-2 font-medium ${getColorClass(acc.type)}`}>
                        {acc.name}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => (
                    <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                      <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                      {accounts.map(acc => (
                        <td key={acc.id} className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">
                          {formatCurrency(yearData.remainingBalances[acc.id] || 0)}
                        </td>
                      ))}
                      <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                        {formatCurrency(yearData.totalRemainingBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {viewMode === 'taxes' && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Gross Income</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Taxable Income</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Federal Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-orange-600 dark:text-orange-400">State Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Penalties</th>
                    <th className="text-right py-2 px-2 font-medium text-red-600 dark:text-red-400">Total Tax</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Tax Bracket</th>
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Effective Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => {
                    const effectiveRate = yearData.grossIncome > 0 ? yearData.totalTax / yearData.grossIncome : 0;
                    const hasPenalties = yearData.totalPenalties > 0;
                    const isPenaltyExpanded = expandedPenaltyRows.has(yearData.age);
                    return (
                      <>
                        <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                          <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-900 dark:text-white">{formatCurrency(yearData.grossIncome)}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatCurrency(yearData.taxableIncome)}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(yearData.federalTax)}</td>
                          <td className="py-2 px-2 text-right font-mono text-orange-600 dark:text-orange-400">{formatCurrency(yearData.stateTax)}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-500 font-medium">
                            {hasPenalties ? (
                              <button
                                onClick={() => togglePenaltyRow(yearData.age)}
                                className="hover:underline cursor-pointer"
                              >
                                {formatCurrency(yearData.totalPenalties)}
                                {yearData.earlyWithdrawalPenalties.length > 0 && (
                                  <span className="ml-1 text-xs">
                                    {isPenaltyExpanded ? '▼' : '▶'}
                                  </span>
                                )}
                              </button>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(yearData.totalTax)}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-700 dark:text-gray-300">
                            <div>{(yearData.taxBracket.rate * 100).toFixed(0)}%</div>
                            <div className="text-xs text-gray-400 dark:text-gray-500">{formatBracketRange(yearData.taxBracket.min, yearData.taxBracket.max)}</div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">{formatPercent(effectiveRate)}</td>
                        </tr>
                        {hasPenalties && isPenaltyExpanded && yearData.earlyWithdrawalPenalties.length > 0 && (
                          <tr key={`${yearData.age}-penalties`} className="border-b border-gray-100 dark:border-gray-800 bg-red-50 dark:bg-red-900/10">
                            <td colSpan={8} className="py-2 px-2">
                              <div className="pl-4 border-l-2 border-red-300 dark:border-red-700">
                                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Early Withdrawal Penalty Details:</p>
                                {yearData.earlyWithdrawalPenalties.map((penalty, idx) => (
                                  <div key={idx} className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                                    <span>{penalty.accountName}</span>
                                    <span className="text-red-600 dark:text-red-500 font-medium">
                                      {formatCurrency(penalty.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-900">Lifetime Total</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                      {formatCurrency(totalGrossIncome)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-600 dark:text-gray-400">
                      {formatCurrency(totalTaxableIncome)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-400">
                      {formatCurrency(sum(y => y.federalTax))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-orange-600 dark:text-orange-400">
                      {formatCurrency(sum(y => y.stateTax))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-500">
                      {formatCurrency(sum(y => y.totalPenalties))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium text-red-600 dark:text-red-400">
                      {formatCurrency(result.lifetimeTaxesPaid)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">-</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">
                      {formatPercent(totalGrossIncome > 0 ? result.lifetimeTaxesPaid / totalGrossIncome : 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {viewMode === 'incomeStreams' && incomeStreams.length > 0 && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">Age</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Year</th>
                    {incomeStreams.map(stream => (
                      <th key={stream.id} className="text-right py-2 px-2 font-medium" style={{ color: getStreamColor(stream.taxTreatment) }}>
                        {stream.name}
                      </th>
                    ))}
                    {hasGovBenefits && (
                      <th className="text-right py-2 px-2 font-medium" style={{ color: CHART_COLORS.socialSecurity }}>
                        Gov. Benefits
                      </th>
                    )}
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.yearlyWithdrawals.map((yearData) => {
                    const activeStreams = incomeStreams.filter(s => yearData.age >= s.startAge && (!s.endAge || yearData.age <= s.endAge));
                    const totalMonthly = activeStreams.reduce((s, st) => s + st.monthlyAmount, 0);

                    return (
                      <tr key={yearData.age} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2 px-2 font-medium text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800">{yearData.age}</td>
                        <td className="py-2 px-2 text-gray-600 dark:text-gray-400">{yearData.year}</td>
                        {incomeStreams.map(stream => {
                          if (yearData.age < stream.startAge || (stream.endAge && yearData.age > stream.endAge) || totalMonthly === 0) {
                            return <td key={stream.id} className="py-2 px-2 text-right font-mono text-gray-400 dark:text-gray-600">-</td>;
                          }
                          const ratio = stream.monthlyAmount / totalMonthly;
                          const amount = yearData.incomeStreamIncome * ratio;
                          return (
                            <td key={stream.id} className="py-2 px-2 text-right font-mono" style={{ color: getStreamColor(stream.taxTreatment) }}>
                              {formatCurrency(amount)}
                            </td>
                          );
                        })}
                        {hasGovBenefits && (
                          <td className="py-2 px-2 text-right font-mono text-gray-600 dark:text-gray-400">
                            {yearData.governmentBenefitIncome > 0 ? formatCurrency(yearData.governmentBenefitIncome) : '-'}
                          </td>
                        )}
                        <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                          {(yearData.governmentBenefitIncome + yearData.incomeStreamIncome) > 0
                            ? formatCurrency(yearData.governmentBenefitIncome + yearData.incomeStreamIncome)
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
                    <td className="py-2 px-2 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-900">Lifetime Total</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-400">-</td>
                    {incomeStreams.map(stream => {
                      const total = result.yearlyWithdrawals.reduce((acc, yearData) => {
                        const activeStreams = incomeStreams.filter(s => yearData.age >= s.startAge && (!s.endAge || yearData.age <= s.endAge));
                        const totalMonthly = activeStreams.reduce((s, st) => s + st.monthlyAmount, 0);
                        if (yearData.age < stream.startAge || (stream.endAge && yearData.age > stream.endAge) || totalMonthly === 0) return acc;
                        return acc + yearData.incomeStreamIncome * (stream.monthlyAmount / totalMonthly);
                      }, 0);
                      return (
                        <td key={stream.id} className="py-2 px-2 text-right font-mono font-medium" style={{ color: getStreamColor(stream.taxTreatment) }}>
                          {formatCurrency(total)}
                        </td>
                      );
                    })}
                    {hasGovBenefits && (
                      <td className="py-2 px-2 text-right font-mono font-medium text-gray-600 dark:text-gray-400">
                        {formatCurrency(sum(y => y.governmentBenefitIncome))}
                      </td>
                    )}
                    <td className="py-2 px-2 text-right font-mono font-medium text-gray-900 dark:text-white">
                      {formatCurrency(sum(y => y.governmentBenefitIncome + y.incomeStreamIncome))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            {viewMode === 'incomeStreams' && incomeStreams.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400 text-sm py-8 text-center">
                No income streams configured. Add Social Security, pensions, or other income in the Income Streams panel.
              </p>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-blue-500"></span>
              <span className="text-gray-600 dark:text-gray-400">Pre-tax (RMD required)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green-500"></span>
              <span className="text-gray-600 dark:text-gray-400">Roth (tax-free)</span>
            </div>
            {hasRothConversion && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-600"></span>
                <span className="text-gray-600 dark:text-gray-400">Roth Conversion (taxable now, tax-free later)</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-500"></span>
              <span className="text-gray-600 dark:text-gray-400">Taxable (capital gains)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-purple-500"></span>
              <span className="text-gray-600 dark:text-gray-400">HSA</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.socialSecurity }}></span>
              <span className="text-gray-600 dark:text-gray-400">Social Security</span>
            </div>
            {incomeStreams.some(s => s.taxTreatment === 'fully_taxable') && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.pension }}></span>
                <span className="text-gray-600 dark:text-gray-400">Pension / Annuity</span>
              </div>
            )}
            {incomeStreams.some(s => s.taxTreatment === 'other_income') && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.otherIncome }}></span>
                <span className="text-gray-600 dark:text-gray-400">Other Income</span>
              </div>
            )}
            {incomeStreams.some(s => s.taxTreatment === 'tax_free') && (
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.taxFreeIncome }}></span>
                <span className="text-gray-600 dark:text-gray-400">Tax-Free Income</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
