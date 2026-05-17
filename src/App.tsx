import { useState, useCallback, useEffect } from 'react';
import { Account, Profile } from './types';
import { useRetirementCalc } from './hooks/useRetirementCalc';
import { useDarkMode } from './hooks/useLocalStorage';
import { useScenarios, createDefaultScenarioData } from './hooks/useScenarios';
import { CountryProvider, useCountry } from './contexts/CountryContext';
import { getCountryConfig, type CountryCode } from './countries';
import { getDefaultWithdrawalAge } from './utils/withdrawalDefaults';
import { Layout } from './components/Layout';
import { AccountList } from './components/AccountList';
import { ProfileForm } from './components/ProfileForm';
import { AssumptionsForm } from './components/AssumptionsForm';
import { IncomeStreamList } from './components/IncomeStreamList';
import { SummaryCards } from './components/SummaryCards';
import { ChartAccumulation } from './components/ChartAccumulation';
import { ChartDrawdown } from './components/ChartDrawdown';
import { ChartIncome } from './components/ChartIncome';
import { ChartTax } from './components/ChartTax';
import { ChartComposition } from './components/ChartComposition';
import { MethodologyPanel } from './components/MethodologyPanel';
import { WithdrawalStrategyForm } from './components/WithdrawalStrategyForm';
import { DataTableAccumulation } from './components/DataTableAccumulation';
import { DataTableWithdrawal } from './components/DataTableWithdrawal';
import { ScenarioSelector } from './components/ScenarioSelector';

/**
 * Ensure every account has withdrawal rules (backwards compat for legacy data).
 */
function normalizeAccount(account: Account, profile: Profile): Account {
  if (account.withdrawalRules) return account;
  const countryConfig = getCountryConfig(profile.country);
  return {
    ...account,
    withdrawalRules: { startAge: getDefaultWithdrawalAge(account, profile.retirementAge, countryConfig) },
  };
}

type TabType = 'accumulation' | 'retirement' | 'summary' | 'yearByYear' | 'methodology';

function AppContent() {
  const { country, config: countryConfig, setCountryDirect } = useCountry();

  const {
    scenarios,
    activeId,
    activeScenario,
    accounts: rawAccounts,
    profile,
    assumptions,
    incomeStreams,
    withdrawalStrategy,
    setAccounts: setRawAccounts,
    setProfile,
    setAssumptions,
    setIncomeStreams,
    setWithdrawalStrategy,
    loadScenario,
    createScenario,
    renameScenario,
    deleteScenario,
  } = useScenarios();

  // Keep CountryContext in sync when the active scenario's country changes
  useEffect(() => {
    if (activeScenario.country !== country) {
      setCountryDirect(activeScenario.country);
    }
  }, [activeScenario.country, country, setCountryDirect]);

  // Normalize accounts (add withdrawal rules if missing)
  const accounts = rawAccounts.map(a => normalizeAccount(a, profile));
  const setAccounts = useCallback(
    (value: Account[] | ((prev: Account[]) => Account[])) => {
      setRawAccounts(typeof value === 'function'
        ? prev => value(prev).map(a => normalizeAccount(a, profile))
        : value.map(a => normalizeAccount(a, profile))
      );
    },
    [setRawAccounts, profile]
  );

  const [isDarkMode, toggleDarkMode] = useDarkMode();
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [expandedSection, setExpandedSection] = useState<string | null>('accounts');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const { accumulation, retirement } = useRetirementCalc(
    accounts, profile, assumptions, countryConfig, incomeStreams, withdrawalStrategy
  );

  // --- Account handlers ---
  const handleAddAccount = (account: Account) => setAccounts(prev => [...prev, account]);
  const handleUpdateAccount = (updated: Account) =>
    setAccounts(prev => prev.map(a => (a.id === updated.id ? updated : a)));
  const handleDeleteAccount = (id: string) =>
    setAccounts(prev => prev.filter(a => a.id !== id));

  // --- Income stream handlers ---
  const handleAddIncomeStream = (stream: typeof incomeStreams[number]) =>
    setIncomeStreams(prev => [...prev, stream]);
  const handleUpdateIncomeStream = (updated: typeof incomeStreams[number]) =>
    setIncomeStreams(prev => prev.map(s => (s.id === updated.id ? updated : s)));
  const handleDeleteIncomeStream = (id: string) =>
    setIncomeStreams(prev => prev.filter(s => s.id !== id));

  const toggleSection = (section: string) =>
    setExpandedSection(prev => (prev === section ? null : section));

  // --- Reset active scenario to country defaults ---
  const handleReset = useCallback(() => setShowResetConfirm(true), []);
  const confirmReset = useCallback(() => {
    const defaults = createDefaultScenarioData(activeScenario.country);
    setRawAccounts(defaults.accounts);
    setProfile(defaults.profile);
    setAssumptions(defaults.assumptions);
    setIncomeStreams(defaults.incomeStreams);
    setWithdrawalStrategy(defaults.withdrawalStrategy);
    setShowResetConfirm(false);
  }, [activeScenario.country, setRawAccounts, setProfile, setAssumptions, setIncomeStreams, setWithdrawalStrategy]);
  const cancelReset = useCallback(() => setShowResetConfirm(false), []);

  // --- Scenario handlers ---
  const handleLoadScenario = useCallback((id: string) => {
    const target = scenarios.find(s => s.id === id);
    if (!target) return;
    // Sync country context immediately (before state update) to avoid a mis-matched render
    if (target.country !== country) {
      setCountryDirect(target.country);
    }
    loadScenario(id);
  }, [scenarios, country, setCountryDirect, loadScenario]);

  const handleCreateFromDefaults = useCallback((name: string, scenarioCountry: CountryCode) => {
    const data = createDefaultScenarioData(scenarioCountry);
    if (scenarioCountry !== country) setCountryDirect(scenarioCountry);
    createScenario(name, data);
  }, [country, setCountryDirect, createScenario]);

  const handleCreateFromCurrent = useCallback((name: string) => {
    createScenario(name, {
      country: activeScenario.country,
      accounts: rawAccounts,
      profile,
      assumptions,
      incomeStreams,
      withdrawalStrategy,
    });
  }, [createScenario, activeScenario.country, rawAccounts, profile, assumptions, incomeStreams, withdrawalStrategy]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'accumulation', label: 'Accumulation Phase' },
    { id: 'retirement', label: 'Retirement Phase' },
    { id: 'yearByYear', label: 'Year-by-Year Data' },
    { id: 'methodology', label: 'Methodology' },
  ];

  return (
    <Layout
      isDarkMode={isDarkMode}
      onToggleDarkMode={toggleDarkMode}
      onReset={handleReset}
      scenarioSelector={
        <ScenarioSelector
          scenarios={scenarios}
          activeId={activeId}
          onLoad={handleLoadScenario}
          onCreateFromDefaults={handleCreateFromDefaults}
          onCreateFromCurrent={handleCreateFromCurrent}
          onRename={renameScenario}
          onDelete={deleteScenario}
        />
      }
    >
      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Reset "{activeScenario.name}"?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              This will reset all data in the current scenario to defaults.
              Other scenarios are not affected.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={cancelReset}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={confirmReset}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Inputs */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('accounts')}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
            >
              <span className="font-medium text-gray-900 dark:text-white">Investment Accounts</span>
              <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expandedSection === 'accounts' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSection === 'accounts' && (
              <div className="px-4 pb-4">
                <AccountList
                  accounts={accounts}
                  profile={profile}
                  countryConfig={countryConfig}
                  onAdd={handleAddAccount}
                  onUpdate={handleUpdateAccount}
                  onDelete={handleDeleteAccount}
                />
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('profile')}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
            >
              <span className="font-medium text-gray-900 dark:text-white">Personal Profile</span>
              <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expandedSection === 'profile' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSection === 'profile' && (
              <div className="px-4 pb-4">
                <ProfileForm profile={profile} onChange={setProfile} />
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('incomeStreams')}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
            >
              <span className="font-medium text-gray-900 dark:text-white">Income Streams</span>
              <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expandedSection === 'incomeStreams' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSection === 'incomeStreams' && (
              <div className="px-4 pb-4">
                <IncomeStreamList
                  incomeStreams={incomeStreams}
                  onAdd={handleAddIncomeStream}
                  onUpdate={handleUpdateIncomeStream}
                  onDelete={handleDeleteIncomeStream}
                />
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('assumptions')}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
            >
              <span className="font-medium text-gray-900 dark:text-white">Economic Assumptions</span>
              <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expandedSection === 'assumptions' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSection === 'assumptions' && (
              <div className="px-4 pb-4">
                <AssumptionsForm assumptions={assumptions} onChange={setAssumptions} />
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => toggleSection('withdrawalStrategy')}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
            >
              <span className="font-medium text-gray-900 dark:text-white">Withdrawal Strategy</span>
              <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expandedSection === 'withdrawalStrategy' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSection === 'withdrawalStrategy' && (
              <div className="px-4 pb-4">
                <WithdrawalStrategyForm strategy={withdrawalStrategy} onChange={setWithdrawalStrategy} />
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Charts and Results */}
        <div className="lg:col-span-2 space-y-6">
          {accounts.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
              <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Accounts Added</h3>
              <p className="text-gray-500 dark:text-gray-400">Add investment accounts to see your retirement projections.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="flex space-x-8 overflow-x-auto scrollbar-hide">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                        activeTab === tab.id
                          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {activeTab === 'summary' && (
                <div className="space-y-6">
                  <SummaryCards
                    accounts={accounts}
                    profile={profile}
                    assumptions={assumptions}
                    accumulationResult={accumulation}
                    retirementResult={retirement}
                  />
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Portfolio Composition at Retirement</h3>
                    <ChartComposition accounts={accounts} result={accumulation} isDarkMode={isDarkMode} />
                  </div>
                </div>
              )}

              {activeTab === 'accumulation' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Account Growth (Age {profile.currentAge} to {profile.retirementAge})
                    </h3>
                    <ChartAccumulation accounts={accounts} result={accumulation} isDarkMode={isDarkMode} />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Portfolio Composition at Retirement</h3>
                    <ChartComposition accounts={accounts} result={accumulation} isDarkMode={isDarkMode} />
                  </div>
                </div>
              )}

              {activeTab === 'retirement' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Portfolio Drawdown (Age {profile.retirementAge} to {profile.lifeExpectancy})
                    </h3>
                    <ChartDrawdown accounts={accounts} result={retirement} isDarkMode={isDarkMode} />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Annual Retirement Income</h3>
                    <ChartIncome result={retirement} incomeStreams={incomeStreams} isDarkMode={isDarkMode} />
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tax Burden Over Time</h3>
                    <ChartTax result={retirement} isDarkMode={isDarkMode} />
                  </div>
                </div>
              )}

              {activeTab === 'yearByYear' && (
                <div className="space-y-6">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Accumulation Phase (Age {profile.currentAge} to {profile.retirementAge})
                    </h3>
                  </div>
                  <DataTableAccumulation accounts={accounts} result={accumulation} />
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Retirement Phase (Age {profile.retirementAge} to {profile.lifeExpectancy})
                    </h3>
                  </div>
                  <DataTableWithdrawal
                    accounts={accounts}
                    result={retirement}
                    incomeStreams={incomeStreams}
                    inflationRate={assumptions.inflationRate}
                  />
                </div>
              )}

              {activeTab === 'methodology' && (
                <MethodologyPanel profile={profile} assumptions={assumptions} />
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

// Outer wrapper: CountryProvider with a handler that updates the active scenario before reloading
function App() {
  const handleCountryChange = useCallback((newCountry: CountryCode) => {
    // Update the active scenario in localStorage with the new country's defaults,
    // then reload so CountryProvider and all hooks reinitialise cleanly.
    try {
      const scenariosRaw = localStorage.getItem('retirement-planner-scenarios');
      const activeId = localStorage.getItem('retirement-planner-active-scenario-id');
      if (scenariosRaw && activeId) {
        const scenarios = JSON.parse(scenariosRaw);
        const defaults = createDefaultScenarioData(newCountry);
        const updated = scenarios.map((s: { id: string }) =>
          s.id === activeId ? { ...s, ...defaults } : s
        );
        localStorage.setItem('retirement-planner-scenarios', JSON.stringify(updated));
      }
      localStorage.setItem('retirement-planner-country', newCountry);
    } catch { /* ignore */ }
    window.location.reload();
  }, []);

  return (
    <CountryProvider initialCountry="US" onCountryChange={handleCountryChange}>
      <AppContent />
    </CountryProvider>
  );
}

export default App;
