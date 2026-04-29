/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useCallback } from "react";
import { AppDefinition } from "../types";

interface IconProps {
  app: AppDefinition;
  onInteract: (app: AppDefinition) => void;
}

export const Icon = React.memo<IconProps>(({ app, onInteract }) => {
  const handleClick = useCallback(() => {
    onInteract(app);
  }, [onInteract, app]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onInteract(app);
      }
    },
    [onInteract, app],
  );

  return (
    <div
      className="icon"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Open ${app.name}`}
    >
      <div className="icon-image">{app.icon}</div>
      <div className="icon-label">{app.name}</div>
    </div>
  );
});
