// Barrel export — re-exports everything from all modal files
// ES module.

export { createModalPopup } from './ModalFactory.js';
export { showTaskDetails, hideTaskDetails } from './TaskDetailsModal.js';
export { showAgentDetails, hideAgentDetails } from './AgentDetailsModal.js';
export { showPermissionPopup, hidePermissionPopup } from './PermissionModal.js';
export { showConfirmModal, hideConfirmModal } from './ConfirmModal.js';
export { showErrorPopup } from './ErrorModal.js';
export { showHistoryPopup } from './HistoryModal.js';
export { showArchivePopup } from './ArchiveModal.js';
export { showSettingsPopup, applyCustomTheme, clearCustomTheme } from './SettingsModal.js';
export { showProjectModal, getAllDashboardProjects, getDashboardProject, saveDashboardProject } from './ProjectModal.js';
export { showTaskEditorModal } from './TaskEditorModal.js';
export { showWorkerTerminal } from './WorkerTerminalModal.js';
export { showPlanningModal } from './PlanningModal.js';
export { showCommandsModal } from './CommandsModal.js';
