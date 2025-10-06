import React, { useEffect, useMemo, useRef } from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { useTabServiceWithSelector } from "../store/tabServiceStore";
import { TabItem } from "./TabItem";
import { useMatchedTabSource } from "../hooks/useMatchedTabSource";
import { Outlet, unstable_useBlocker } from "react-router-dom";
import { DraftRequestContainerTabSource } from "features/apiClient/screens/apiClient/components/views/components/DraftRequestContainer/draftRequestContainerTabSource";
import { RQButton } from "lib/design-system-v2/components";
import { MdClose } from "@react-icons/all-files/md/MdClose";
import { useSetUrl } from "../hooks/useSetUrl";
import PATHS from "config/constants/sub/paths";
import { trackTabReordered } from "modules/analytics/events/misc/apiClient";
import { Typography } from "antd";
import "./tabsContainer.scss";

export const TabsContainer: React.FC = () => {
  const [
    activeTabId,
    activeTabSource,
    setActiveTab,
    tabs,
    openTab,
    closeTabById,
    incrementVersion,
    resetPreviewTab,
    consumeIgnorePath,
    cleanupCloseBlockers,
    tabOrder,
    updateTabOrder,
    getTabIdBySource,
  ] = useTabServiceWithSelector((state) => [
    state.activeTabId,
    state.activeTabSource,
    state.setActiveTab,
    state.tabs,
    state.openTab,
    state.closeTabById,
    state.incrementVersion,
    state.resetPreviewTab,
    state.consumeIgnorePath,
    state.cleanupCloseBlockers,
    state.tabOrder,
    state.updateTabOrder,
    state.getTabIdBySource,
  ]);

  const { setUrl } = useSetUrl();

  const hasUnsavedChanges = Array.from(tabs.values()).some(
    (tab) => tab.getState().unsaved || !tab.getState().canCloseTab()
  );

  useEffect(() => {
    const unloadListener = (e: any) => {
      e.preventDefault();
      e.returnValue = "Are you sure?";
    };
    if (hasUnsavedChanges) window.addEventListener("beforeunload", unloadListener);
    return () => window.removeEventListener("beforeunload", unloadListener);
  }, [hasUnsavedChanges]);

  unstable_useBlocker(({ nextLocation }) => {
    const isNextLocationApiClientView = nextLocation.pathname.startsWith("/api-client");
    const shouldBlock = !isNextLocationApiClientView && hasUnsavedChanges;
    if (isNextLocationApiClientView) return false;
    if (shouldBlock) {
      const blockedTab = Array.from(tabs.values()).find((t) => t.getState().getActiveBlocker());
      const blocker = blockedTab?.getState().getActiveBlocker();
      const shouldDiscardChanges = window.confirm(
        blocker?.details?.title || "Discard changes? Changes you made will not be saved."
      );
      const blockNavigation = !shouldDiscardChanges;
      if (!blockNavigation) cleanupCloseBlockers();
      return blockNavigation;
    }
    return false;
  });

  const matchedTabSource = useMatchedTabSource();
  useEffect(() => {
    const ignorePath = consumeIgnorePath();
    if (!matchedTabSource || ignorePath) return;

    const source = matchedTabSource.sourceFactory(matchedTabSource.matchedPath);
    const existingTabId = getTabIdBySource(source.getSourceId(), source.getSourceName());
    if (!existingTabId) {
      openTab(source);
    } else {
      setActiveTab(existingTabId);
    }
  }, [matchedTabSource, openTab, consumeIgnorePath, getTabIdBySource, setActiveTab]);

  const isInitialLoadRef = useRef(true);
  useEffect(() => {
    if (activeTabSource) {
      const newPath = activeTabSource.getUrlPath();
      if (newPath !== window.location.pathname + window.location.search) {
        setUrl(newPath, isInitialLoadRef.current);
      }
      if (isInitialLoadRef.current) isInitialLoadRef.current = false;
    } else {
      setUrl(PATHS.API_CLIENT.ABSOLUTE, isInitialLoadRef.current);
    }
  }, [activeTabSource, setUrl]);

  const onDragEnd = (result: any) => {
    if (!result.destination) return;
    const newOrder = Array.from(tabOrder);
    const [moved] = newOrder.splice(result.source.index, 1);
    newOrder.splice(result.destination.index, 0, moved);
    updateTabOrder(newOrder);
    sessionStorage.setItem("rq-api-client-tab-order", JSON.stringify(newOrder));
    trackTabReordered(newOrder);
  };

  const tabItems = useMemo(() => {
    return tabOrder
      .map((tabId) => {
        const tabStore = tabs.get(tabId);
        if (!tabStore) return null;
        const tabState = tabStore.getState();
        return {
          key: tabState.id.toString(),
          tabId,
          label: (
            <div
              className="tab-title-container"
              onDoubleClick={() => {
                if (tabState.preview) {
                  tabState.setPreview(false);
                  incrementVersion();
                  resetPreviewTab();
                }
              }}
            >
              <div className="tab-title">
                {tabState.icon && <div className="icon">{tabState.icon}</div>}
                <Typography.Text
                  ellipsis={{
                    tooltip: { title: tabState.title, placement: "bottom", color: "#000", mouseEnterDelay: 0.5 },
                  }}
                  className="title"
                >
                  {tabState.preview ? <i>{tabState.title}</i> : tabState.title}
                </Typography.Text>
              </div>
              <div className="tab-actions">
                <RQButton
                  size="small"
                  type="transparent"
                  className="tab-close-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTabById(tabState.id);
                  }}
                  icon={<MdClose />}
                />
                {tabState.unsaved ? <div className="unsaved-changes-indicator" /> : null}
              </div>
            </div>
          ),
          children: <TabItem store={tabStore}>{tabState.source.render()}</TabItem>,
        };
      })
      .filter(Boolean);
  }, [tabs, tabOrder, closeTabById, incrementVersion, resetPreviewTab]);

  return tabOrder.length === 0 ? (
    <div className="tabs-outlet-container">
      <Outlet />
    </div>
  ) : (
    <div className="tabs-container">
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="api-client-tabs" direction="horizontal">
          {(provided) => (
            <ul className="tabs-content" {...provided.droppableProps} ref={provided.innerRef} role="tablist">
              {tabItems.map((item, index) => (
                <Draggable key={item.tabId} draggableId={item.tabId.toString()} index={index}>
                  {(provided, snapshot) => (
                    <li
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`tab-item ${item.key === activeTabId?.toString() ? "ant-tabs-tab-active" : ""} ${
                        snapshot.isDragging ? "dragging" : ""
                      }`}
                      role="tab"
                      aria-selected={item.key === activeTabId?.toString()}
                      onClick={() => setActiveTab(parseInt(item.key))}
                    >
                      {item.label}
                    </li>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              <li className="ant-tabs-nav-add">
                <RQButton
                  type="transparent"
                  onClick={() => openTab(new DraftRequestContainerTabSource())}
                  icon={<span>+</span>}
                />
              </li>
            </ul>
          )}
        </Droppable>
      </DragDropContext>
      <div className="tabs-outlet-container">
        {tabItems.find((item) => item.key === activeTabId?.toString())?.children || <Outlet />}
      </div>
    </div>
  );
};
