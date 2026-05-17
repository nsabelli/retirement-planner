import { useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Scenario } from '../types';

interface ScenarioFile {
  version: number;
  exportedAt: string;
  scenarios: Scenario[];
}

type ImportDecision = 'overwrite' | 'keep_both';

interface ImportEntry {
  incoming: Scenario;
  conflict: Scenario | null; // existing scenario with same name
  selected: boolean;
  decision: ImportDecision;
}

interface ScenarioExportImportProps {
  scenarios: Scenario[];
  onImport: (scenarios: Scenario[]) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ScenarioExportImport({ scenarios, onImport }: ScenarioExportImportProps) {
  // Export state
  const [showExport, setShowExport] = useState(false);
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set());

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importEntries, setImportEntries] = useState<ImportEntry[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Export ---

  function openExport() {
    setExportSelected(new Set(scenarios.map(s => s.id)));
    setShowExport(true);
  }

  function toggleExportScenario(id: string) {
    setExportSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExportAll() {
    setExportSelected(prev =>
      prev.size === scenarios.length ? new Set() : new Set(scenarios.map(s => s.id))
    );
  }

  function handleDownload() {
    const toExport = scenarios.filter(s => exportSelected.has(s.id));
    if (toExport.length === 0) return;
    const file: ScenarioFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      scenarios: toExport,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-scenarios-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExport(false);
  }

  // --- Import ---

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so the same file can be re-selected

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const raw = JSON.parse(event.target?.result as string) as ScenarioFile;
        if (!raw.scenarios || !Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
          setImportError('No scenarios found in the file. Make sure you are using a valid export.');
          setImportEntries([]);
          setShowImport(true);
          return;
        }
        // Basic shape validation on each scenario
        const valid = raw.scenarios.filter(
          s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.accounts && s.profile
        );
        if (valid.length === 0) {
          setImportError('The file contains no valid scenarios.');
          setImportEntries([]);
          setShowImport(true);
          return;
        }
        const entries: ImportEntry[] = valid.map(incoming => ({
          incoming,
          conflict: scenarios.find(e => e.name === incoming.name) ?? null,
          selected: true,
          decision: 'keep_both',
        }));
        setImportEntries(entries);
        setImportError(null);
        setShowImport(true);
      } catch {
        setImportError('Could not parse the file. Please select a valid JSON export.');
        setImportEntries([]);
        setShowImport(true);
      }
    };
    reader.readAsText(file);
  }

  function toggleImportEntry(idx: number) {
    setImportEntries(prev =>
      prev.map((e, i) => i === idx ? { ...e, selected: !e.selected } : e)
    );
  }

  function setDecision(idx: number, decision: ImportDecision) {
    setImportEntries(prev =>
      prev.map((e, i) => i === idx ? { ...e, decision } : e)
    );
  }

  function toggleImportAll() {
    const allSelected = importEntries.every(e => e.selected);
    setImportEntries(prev => prev.map(e => ({ ...e, selected: !allSelected })));
  }

  function handleImportConfirm() {
    const toImport: Scenario[] = importEntries
      .filter(e => e.selected)
      .map(e => {
        if (e.conflict && e.decision === 'overwrite') {
          // Use existing scenario's ID so importScenarios replaces it in-place
          return { ...e.incoming, id: e.conflict.id, name: e.conflict.name };
        }
        // New UUID: append as a fresh scenario (keep_both or no conflict)
        return { ...e.incoming, id: uuidv4(), createdAt: Date.now() };
      });
    onImport(toImport);
    setShowImport(false);
    setImportEntries([]);
  }

  const selectedExportCount = exportSelected.size;
  const selectedImportCount = importEntries.filter(e => e.selected).length;

  return (
    <>
      {/* Trigger buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={openExport}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium
                     text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600
                     hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors"
          title="Export scenarios to JSON"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium
                     text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600
                     hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors"
          title="Import scenarios from JSON"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* ── Export Modal ───────────────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Export Scenarios</h2>
              <button onClick={() => setShowExport(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scenario list */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {selectedExportCount} of {scenarios.length} selected
                </p>
                <button
                  onClick={toggleExportAll}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {exportSelected.size === scenarios.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {scenarios.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700
                             hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={exportSelected.has(s.id)}
                    onChange={() => toggleExportScenario(s.id)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {s.country === 'CA' ? '🇨🇦 Canada' : '🇺🇸 United States'} · {formatDate(s.createdAt)}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowExport(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300
                           bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                disabled={selectedExportCount === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
                           bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800
                           disabled:cursor-not-allowed rounded-md transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download JSON ({selectedExportCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Modal ───────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Import Scenarios</h2>
              <button
                onClick={() => { setShowImport(false); setImportEntries([]); setImportError(null); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {importError ? (
                <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-sm text-red-700 dark:text-red-300">{importError}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {selectedImportCount} of {importEntries.length} scenario{importEntries.length !== 1 ? 's' : ''} selected for import
                    </p>
                    <button
                      onClick={toggleImportAll}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {importEntries.every(e => e.selected) ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {importEntries.map((entry, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg border p-3 transition-colors ${
                          entry.selected
                            ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 opacity-60'
                        }`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={entry.selected}
                            onChange={() => toggleImportEntry(idx)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 mt-0.5 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {entry.incoming.name}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {entry.incoming.country === 'CA' ? '🇨🇦' : '🇺🇸'}
                                {entry.incoming.createdAt
                                  ? ` · ${formatDate(entry.incoming.createdAt)}`
                                  : ''}
                              </span>
                            </div>

                            {entry.conflict ? (
                              /* Name conflict: show overwrite vs keep-both toggle */
                              <div className="mt-2">
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z" />
                                  </svg>
                                  Matches existing scenario "{entry.conflict.name}"
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => entry.selected && setDecision(idx, 'overwrite')}
                                    disabled={!entry.selected}
                                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                                      entry.decision === 'overwrite'
                                        ? 'bg-amber-500 text-white border-amber-500'
                                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-amber-400'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                  >
                                    Overwrite existing
                                  </button>
                                  <button
                                    onClick={() => entry.selected && setDecision(idx, 'keep_both')}
                                    disabled={!entry.selected}
                                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                                      entry.decision === 'keep_both'
                                        ? 'bg-blue-500 text-white border-blue-500'
                                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                  >
                                    Keep both
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                New scenario
                              </p>
                            )}
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => { setShowImport(false); setImportEntries([]); setImportError(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300
                           bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md"
              >
                Cancel
              </button>
              {!importError && (
                <button
                  onClick={handleImportConfirm}
                  disabled={selectedImportCount === 0}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
                             bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800
                             disabled:cursor-not-allowed rounded-md transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  Import ({selectedImportCount})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
