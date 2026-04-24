/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React from "react";
import { AppDefinition } from "../types";

interface IconProps {
  app: AppDefinition;
  onInteract: () => void;
}

export const Icon: React.FC<IconProps> = ({ app, onInteract }) => {
  return (
    <div
      className="icon"
      onClick={onInteract}
      onKeyDown={(e) => e.key === "Enter" && onInteract()}
      tabIndex={0}
      role="button"
      aria-label={`Open ${app.name}`}
    >
      <div className="icon-image">{app.icon}</div>
      <div className="icon-label">{app.name}</div>
    </div>
  );
};
