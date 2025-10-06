import { create, StoreApi, UseBoundStore, useStore } from "zustand";
import { persist, StorageValue } from "zustand/middleware";
import * as Sentry from "@sentry/react";
import { createTabStore, TabState } from "./tabStore";
import { AbstractTabSource } from "../helpers/tabSource";
import { TAB_SOURCES_MAP } from "../constants";
import { setLastUsedContextId } from "features/apiClient/store/apiClientFeatureContext/apiClientFeatureContext.store";
import { useShallow } from "zustand/shallow";
import { createContext, useContext } from "react";

type TabId = number;
type SourceName = string;
type SourceId = string;
type SourceMap = Map<SourceId, TabId>;
type TabStore = StoreApi<TabState>;
type TabConfig = { preview: boolean };

type TabServiceState = {
  tabIdSequence: TabId;
  activeTabId: TabId | undefined;
  activeTabSource: AbstractTabSource | null;
  previewTabId: TabId | undefined;
  previewTabSource: AbstractTabSource | null;
  tabsIndex: Map<SourceName, SourceMap>;
  tabs: Map<TabId, TabStore>;
  tabOrder: TabId[];
  ignorePath: boolean;
  _version: number;
};

type TabActions = {
  reset: (ignorePath?: boolean) => void;
  upsertTabSource: (tabId: TabId | undefined, source: AbstractTabSource, config?: TabConfig) => void;
  updateTabBySource: (
    sourceId: SourceId,
    sourceName: SourceName,
    updates: Partial<Pick<TabState, "preview" | "unsaved" | "title" | "icon">>
  ) => void;
  openTab: (source: AbstractTabSource, config?: TabConfig) => void;
  closeTab: (source: AbstractTabSource, skipUnsavedPrompt?: boolean) => void;
  closeAllTabs: (skipUnsavedPrompt?: boolean) => void;
  closeTabById: (tabId: TabId, skipUnsavedPrompt?: boolean) => void;
  closeTabBySource: (sourceId: SourceId, sourceName: SourceName, skipUnsavedPrompt?: boolean) => void;
  closeTabByContext: (contextId?: string, skipUnsavedPrompt?: boolean) => void;
  resetPreviewTab: () => void;
  setPreviewTab: (tabId: TabId) => void;
  setActiveTab: (tabId: TabId) => void;
  _generateNewTabId: () => TabId;
  incrementVersion: () => void;
  getTabIdBySource: (sourceId: SourceId, sourceName: SourceName) => TabId | undefined;
  getTabStateBySource: (sourceId: SourceId, sourceName: SourceName) => TabState | undefined;
  consumeIgnorePath: () => boolean;
  setIgnorePath: (ignorePath: boolean) => void;
  cleanupCloseBlockers: () => void;
  updateTabOrder: (newOrder: TabId[]) => void;
};

export type TabServiceStore = TabServiceState & TabActions;

const initialState: TabServiceState = {
  tabIdSequence: 0,
  activeTabId: undefined,
  activeTabSource: null,
  previewTabId: undefined,
  previewTabSource: null,
  tabsIndex: new Map(),
  tabs: new Map(),
  tabOrder: [],
  ignorePath: false,
  _version: 0,
};

const createTabServiceStore = () => {
  const tabServiceStore = create<TabServiceStore>()(
    persist(
      (set, get) => ({
        ...initialState,
        setIgnorePath(ignorePath) {
          set({ ignorePath });
        },
        consumeIgnorePath() {
          const { ignorePath } = get();
          if (!ignorePath) return false;
          set({ ignorePath: false });
          return ignorePath;
        },
        reset(ignorePath = false) {
          set({ ...initialState, tabsIndex: new Map(), tabs: new Map(), tabOrder: [], ignorePath });
          tabServiceStore.persist.clearStorage();
        },
        upsertTabSource(tabId, source, config) {
          const sourceId = source.getSourceId();
          const sourceName = source.getSourceName();
          const { tabsIndex, tabs, setActiveTab, tabOrder } = get();

          if (!tabId) return;

          const tab = createTabStore(tabId, source, source.getDefaultTitle(), config?.preview);
          if (tabsIndex.has(sourceName)) {
            tabsIndex.get(sourceName)?.set(sourceId, tabId);
          } else {
            tabsIndex.set(sourceName, new Map().set(sourceId, tabId));
          }

          tabs.set(tabId, tab);

          const newTabOrder = tabOrder.includes(tabId) ? tabOrder : [...tabOrder, tabId];
          set({ tabs: new Map(tabs), tabOrder: newTabOrder });
          setActiveTab(tabId);
        },
        updateTabBySource(sourceId, sourceName, updates) {
          const { tabs, getTabIdBySource, incrementVersion } = get();
          const tabId = getTabIdBySource(sourceId, sourceName);
          if (!tabId) return;

          const tabStore = tabs.get(tabId);
          if (!tabStore) return;

          const tabState = tabStore.getState();
          tabStore.getState().setTitle(updates?.title ?? tabState.title);
          tabStore.getState().setPreview(updates?.preview ?? tabState.preview);
          tabStore.getState().setIcon(updates?.icon ?? tabState.icon);
          incrementVersion();
        },
        openTab(source, config) {
          const sourceId = source.getSourceId();
          const sourceName = source.getSourceName();
          const contextId = source.metadata.context?.id;
          if (contextId) setLastUsedContextId(contextId);

          const {
            _generateNewTabId,
            tabsIndex,
            setActiveTab,
            upsertTabSource,
            previewTabId,
            previewTabSource,
            setPreviewTab,
            getTabIdBySource,
          } = get();
          const existingTabId = getTabIdBySource(sourceId, sourceName);
          if (existingTabId) {
            setActiveTab(existingTabId);
            return;
          }

          if (config?.preview) {
            if (previewTabId && previewTabSource) {
              const oldSourceName = previewTabSource.getSourceName();
              const oldSourceId = previewTabSource.getSourceId();
              tabsIndex.get(oldSourceName)?.delete(oldSourceId);
            }
            const tabId = previewTabId ?? _generateNewTabId();
            upsertTabSource(tabId, source, config);
            setPreviewTab(tabId);
            return;
          }

          const newTabId = _generateNewTabId();
          upsertTabSource(newTabId, source);
        },
        closeTab(source, skipUnsavedPrompt = false) {
          const sourceId = source.getSourceId();
          const sourceName = source.getSourceName();
          const { closeTabById, getTabIdBySource } = get();
          const existingTabId = getTabIdBySource(sourceId, sourceName);
          if (!existingTabId) return;
          closeTabById(existingTabId, skipUnsavedPrompt);
        },
        closeAllTabs(skipUnsavedPrompt) {
          const { tabs, closeTabById } = get();
          tabs.forEach((_, tabId) => closeTabById(tabId, skipUnsavedPrompt));
        },
        cleanupCloseBlockers() {
          const { tabs } = get();
          const blockersToCleanUp = Array.from(tabs.values()).flatMap((t) => t.getState().getActiveBlockers());
          blockersToCleanUp.forEach((blocker) => blocker.details.onConfirm?.());
        },
        closeTabBySource(sourceId, sourceName, skipUnsavedPrompt) {
          const { closeTabById, getTabIdBySource } = get();
          const tabId = getTabIdBySource(sourceId, sourceName);
          if (!tabId) return;
          closeTabById(tabId, skipUnsavedPrompt);
        },
        closeTabByContext(contextId, skipUnsavedPrompt) {
          const { tabs, closeTabById } = get();
          const tabsToClose = Array.from(tabs.values())
            .map((t) => t.getState())
            .filter((t) => t.source.metadata.context?.id === contextId);
          tabsToClose.forEach((t) => closeTabById(t.id, skipUnsavedPrompt));
        },
        closeTabById(tabId, skipUnsavedPrompt) {
          const { tabs, tabsIndex, activeTabId, setActiveTab, tabOrder } = get();
          const tabStore = tabs.get(tabId);
          if (!tabStore) return;

          const tabState = tabStore.getState();
          const sourceName = tabState.source.getSourceName();
          const sourceId = tabState.source.getSourceId();

          if (!skipUnsavedPrompt) {
            const activeBlocker = tabState.getActiveBlocker();
            if (activeBlocker || tabState.unsaved) {
              const canClose = window.confirm(
                activeBlocker?.details.title || "Discard changes? Changes you made will not be saved."
              );
              if (!canClose) {
                activeBlocker?.details.onCancel?.();
                return;
              }
              activeBlocker?.details.onConfirm?.();
            }
          }

          tabsIndex.get(sourceName)?.delete(sourceId);
          if (tabsIndex.get(sourceName)?.size === 0) tabsIndex.delete(sourceName);

          const newTabOrder = tabOrder.filter((id) => id !== tabId);

          const newActiveTabId =
            activeTabId !== tabId
              ? activeTabId
              : (() => {
                  if (newTabOrder.length === 0) return undefined;
                  const currentIndex = tabOrder.indexOf(tabId);
                  const nextIndex = currentIndex < newTabOrder.length ? currentIndex : currentIndex - 1;
                  return nextIndex >= 0 ? newTabOrder[nextIndex] : undefined;
                })();

          tabs.delete(tabId);
          set({ tabs: new Map(tabs), tabOrder: newTabOrder });
          setActiveTab(newActiveTabId);
        },
        resetPreviewTab() {
          set({ previewTabId: undefined, previewTabSource: null });
        },
        setPreviewTab(id: TabId) {
          const { tabs, resetPreviewTab } = get();
          if (tabs.has(id)) {
            set({ previewTabId: id, previewTabSource: tabs.get(id).getState().source });
          } else {
            resetPreviewTab();
          }
        },
        setActiveTab(id: TabId) {
          const { tabs } = get();
          const tab = tabs.get(id);
          if (tab) {
            const tabState = tab.getState();
            set({ activeTabId: id, activeTabSource: tabState.source });
            const contextId = tabState.source.metadata.context?.id;
            if (contextId) setLastUsedContextId(contextId);
          } else {
            set({ activeTabId: undefined, activeTabSource: null });
          }
        },
        _generateNewTabId() {
          const { tabIdSequence } = get();
          const nextId = tabIdSequence + 1;
          set({ tabIdSequence: nextId });
          return nextId;
        },
        incrementVersion() {
          set({ _version: get()._version + 1 });
        },
        getTabIdBySource(sourceId, sourceName) {
          const { tabsIndex } = get();
          return tabsIndex.get(sourceName)?.get(sourceId);
        },
        getTabStateBySource(sourceId, sourceName) {
          const { tabs, getTabIdBySource } = get();
          const tabId = getTabIdBySource(sourceId, sourceName);
          return tabId ? tabs.get(tabId)?.getState() : undefined;
        },
        updateTabOrder(newOrder) {
          set({ tabOrder: newOrder, _version: get()._version + 1 });
        },
      }),
      {
        name: "rq_tabs_store",
        partialize: (state) => ({
          tabIdSequence: state.tabIdSequence,
          activeTabId: state.activeTabId,
          tabsIndex: state.tabsIndex,
          tabs: state.tabs,
          tabOrder: state.tabOrder,
          _version: state._version,
        }),
        onRehydrateStorage: (store) => (store, error: Error) => {
          if (error) {
            Sentry.withScope((scope) => {
              scope.setTag("error_type", "tabs_rehydration_failed");
              scope.setContext("tab_service_store_details", { tabServiceStore: store });
              Sentry.captureException(new Error(`Tabs rehydration failed - error:${error}`));
            });
          }
        },
        storage: {
          setItem: (name, newValue: StorageValue<TabServiceState>) => {
            try {
              const tabs = Array.from(newValue.state.tabs.entries()).map(([tabId, tabStore]) => [
                tabId,
                tabStore.getState(),
              ]);
              const tabsIndex = Array.from(newValue.state.tabsIndex.entries()).map(([sourceName, sourceMap]) => [
                sourceName,
                Array.from(sourceMap.entries()),
              ]);
              const stateString = JSON.stringify({
                ...newValue,
                state: { ...newValue.state, tabs, tabsIndex },
              });
              sessionStorage.setItem(name, stateString);
            } catch (error) {
              throw new Error(`Tab service setItem failed - error: ${error}`);
            }
          },
          getItem: (name) => {
            try {
              const stateString = sessionStorage.getItem(name);
              if (!stateString) return null;

              const existingValue = JSON.parse(stateString);
              const tabsIndex: TabServiceStore["tabsIndex"] = new Map(
                existingValue.state.tabsIndex.map(([sourceName, sourceMap]: [string, Iterable<[SourceId, TabId]>]) => [
                  sourceName,
                  new Map(sourceMap),
                ])
              );
              const tabs: TabServiceStore["tabs"] = new Map(
                existingValue.state.tabs.map(([tabId, tabState]: [TabId, TabState]) => {
                  const source = new TAB_SOURCES_MAP[tabState.source.type](tabState.source.metadata);
                  return [tabId, createTabStore(tabId, source, tabState.title)];
                })
              );
              const activeTabId = existingValue.state.activeTabId;
              const activeTabSource = activeTabId ? tabs.get(activeTabId)?.getState().source : null;

              const storedTabOrder = existingValue.state.tabOrder || [];
              const validTabIds = new Set(tabs.keys());

              const validTabOrder = storedTabOrder.filter((id: TabId) => validTabIds.has(id));
              const missingTabs = Array.from(validTabIds).filter((id) => !validTabOrder.includes(id));
              const finalTabOrder = [...validTabOrder, ...missingTabs];

              return {
                ...existingValue,
                state: {
                  ...existingValue.state,
                  tabs,
                  tabsIndex,
                  activeTabSource,
                  tabOrder: finalTabOrder,
                },
              };
            } catch (error) {
              throw new Error(`Tab service getItem failed - error: ${error}`);
            }
          },
          removeItem: (name) => sessionStorage.removeItem(name),
        },
      }
    )
  );
  return tabServiceStore;
};

type WithSelectors<S> = S extends { getState: () => infer T } ? S & { use: { [K in keyof T]: () => T[K] } } : never;
const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(_store: S) => {
  let store = _store as WithSelectors<typeof _store>;
  store.use = {};
  for (let k of Object.keys(store.getState())) {
    (store.use as any)[k] = () => store((s) => s[k as keyof typeof s]);
  }
  return store;
};

export const tabServiceStore = createTabServiceStore();
export const tabServiceStoreWithAutoSelectors = createSelectors(tabServiceStore);
export const TabServiceStoreContext = createContext(tabServiceStoreWithAutoSelectors);
export const useTabServiceWithSelector = <T>(selector: (state: TabServiceStore) => T) => {
  const store = useContext(TabServiceStoreContext);
  return useStore(store, useShallow(selector));
};
