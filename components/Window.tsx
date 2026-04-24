/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React from "react";

interface WindowProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void; // This prop remains, though its direct trigger (the X button) is removed.
  isAppOpen: boolean;
  appId?: string | null;
  onToggleParameters: () => void;
  onExitToDesktop: () => void;
  isParametersPanelOpen?: boolean;
  onRefreshHealth?: () => void;
  systemStatus?: {
    status: string;
    uptime: number;
    vpsConnected: boolean;
    githubConnected: boolean;
  } | null;
}

const MenuItem: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}> = ({ children, onClick, className }) => (
  <span
    className={`menu-item cursor-pointer hover:text-blue-600 ${className}`}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") onClick?.();
    }}
    tabIndex={0}
    role="button"
  >
    {children}
  </span>
);

export const Window: React.FC<WindowProps> = ({
  title,
  children,
  onClose,
  isAppOpen,
  onToggleParameters,
  onExitToDesktop,
  isParametersPanelOpen,
  systemStatus,
  onRefreshHealth,
}) => {
  return (
    <div className="w-full h-[100dvh] sm:w-[800px] sm:h-[600px] bg-white border border-gray-300 sm:rounded-xl shadow-2xl flex flex-col relative overflow-hidden font-sans backdrop-blur-sm bg-white/80">
      {/* Title Bar */}
      <div className="bg-gray-800/90 text-white py-0 px-1.5 font-semibold text-[9px] sm:text-[10px] flex justify-between items-center select-none cursor-default sm:rounded-t-lg flex-shrink-0 h-[18px]">
        <div className="flex items-center gap-1 overflow-hidden">
          <span className="title-bar-text truncate">{title}</span>
          {systemStatus && (
            <div className="flex gap-0.5 ml-1.5">
              <span
                className={`w-0.5 h-0.5 rounded-full ${systemStatus.vpsConnected ? "bg-green-400" : "bg-red-400"}`}
                title="VPS Connection"
              ></span>
              <span
                className={`w-0.5 h-0.5 rounded-full ${systemStatus.githubConnected ? "bg-green-400" : "bg-white/20"}`}
                title="GitHub Connection"
              ></span>
            </div>
          )}
        </div>
      </div>

      {/* Menu Bar */}
      <div className="bg-gray-100/90 py-0 px-1 border-b border-gray-200 select-none flex gap-0.5 flex-shrink-0 text-[6px] sm:text-[7px] text-gray-700 items-center font-bold uppercase tracking-tight h-[14px]">
        {!isParametersPanelOpen && (
          <MenuItem onClick={onToggleParameters}>Params</MenuItem>
        )}
        {systemStatus && (
          <MenuItem onClick={onRefreshHealth}>
            {systemStatus.status === "ok" ? "Online" : "Error"}
          </MenuItem>
        )}
        {isAppOpen && (
          <MenuItem onClick={onExitToDesktop} className="ml-auto">
            Exit
          </MenuItem>
        )}
      </div>

      {/* Content */}
      <div className="flex-grow overflow-y-auto">{children}</div>
    </div>
  );
};
