/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useEffect, useState } from "react";

export const FileExplorerPanel: React.FC = () => {
    const [path, setPath] = useState("/");
    const [files, setFiles] = useState<{name: string, isDirectory: boolean, path: string}[]>([]);
    const [copyBuffer, setCopyBuffer] = useState<string | null>(null);

    const refreshFiles = async (p = path) => {
        const res = await fetch(`/api/ssh/ls?path=${encodeURIComponent(p)}`);
        const data = await res.json();
        if (Array.isArray(data)) setFiles(data);
    };

    useEffect(() => { refreshFiles(); }, [path]);

    const handleAction = async (action: string, targetPath: string, newPath?: string) => {
        await fetch("/api/ssh/file/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, path: targetPath, newPath }),
        });
        refreshFiles();
    };

    return (
        <div className="p-4 bg-gray-50 h-full overflow-y-auto">
            <h2 className="text-lg font-bold mb-2">File Explorer: {path}</h2>
            <div className="flex gap-2 mb-4">
                <button className="bg-gray-200 p-1 rounded text-xs" onClick={() => {
                    const name = prompt("New folder name:");
                    if (name) handleAction("mkdir", path + "/" + name);
                }}>New Folder</button>
                {copyBuffer && <button className="bg-green-200 p-1 rounded text-xs" onClick={() => {
                     handleAction("copy", copyBuffer, path + "/" + copyBuffer.split('/').pop());
                     setCopyBuffer(null);
                }}>Paste Here</button>}
            </div>
            {files.map(f => (
                <div key={f.path} className="p-2 mb-1 border rounded flex justify-between items-center">
                    <span className="cursor-pointer" onClick={() => f.isDirectory && setPath(f.path)}>{f.name} {f.isDirectory ? "/" : ""}</span>
                    <div className="flex gap-2">
                        <button className="text-xs bg-gray-200 p-1" onClick={() => setCopyBuffer(f.path)}>Copy</button>
                        <button className="text-xs bg-gray-200 p-1" onClick={() => {
                            const name = prompt("New name:");
                            if(name) handleAction("rename", f.path, f.path.split('/').slice(0,-1).join('/') + '/' + name);
                        }}>Rename</button>
                        <button className="text-xs bg-red-200 p-1" onClick={() => handleAction("delete", f.path)}>Delete</button>
                    </div>
                </div>
            ))}
        </div>
    );
};
