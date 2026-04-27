/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React from "react";

export const GitHubManagerPanel: React.FC = () => {
    const handleStash = async () => {
        await fetch("/api/github/stash", { method: "POST" });
        alert("Changes stashed!");
    };
    
    const handleStashPop = async () => {
        await fetch("/api/github/stash-pop", { method: "POST" });
        alert("Stash popped!");
    };

    return (
        <div className="p-4 bg-gray-50 h-full">
            <h2 className="text-lg font-bold mb-4">GitHub Manager</h2>
            <div className="flex gap-2">
                <button className="bg-yellow-500 text-white p-2 rounded" onClick={handleStash}>Stash Changes</button>
                <button className="bg-green-500 text-white p-2 rounded" onClick={handleStashPop}>Stash Pop</button>
            </div>
        </div>
    );
};
