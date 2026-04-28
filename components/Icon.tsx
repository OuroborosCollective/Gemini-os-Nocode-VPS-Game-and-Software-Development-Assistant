/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React from "react";
import { AppDefinition } from "../types";

interface IconProps {
  app: AppDefinition;
  onInteract: (app: AppDefinition) => void;
}

export const Icon = React.memo<IconProps>(({ app, onInteract }) => {
  return (
    <div
      className="icon"
      onClick={() => onInteract(app)}
      onKeyDown={(e) => e.key === "Enter" && onInteract(app)}
      tabIndex={0}
      role="button"
      aria-label={`Open ${app.name}`}
    >
      <div className="icon-image">{app.icon}</div>
      <div className="icon-label">{app.name}</div>
    </div>
  );
});
