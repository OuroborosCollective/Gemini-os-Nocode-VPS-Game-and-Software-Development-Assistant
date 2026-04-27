/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
/* tslint:disable */
import React, { useEffect, useState } from "react";

export const SettingsPanel: React.FC = () => {
  const [keys, setKeys] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");

  const refreshKeys = async () => {
    const res = await fetch("/api/ssh/keys");
    const data = await res.json();
    setKeys(data);
  };

  useEffect(() => {
    refreshKeys();
  }, []);

  const handleAddKey = async () => {
    await fetch("/api/ssh/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, key }),
    });
    setName("");
    setKey("");
    refreshKeys();
  };

  const handleDeleteKey = async (id: string) => {
    await fetch(`/api/ssh/keys/${id}`, { method: "DELETE" });
    refreshKeys();
  };

  const handleSetDefault = async (id: string) => {
    await fetch("/api/ssh/keys/default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    refreshKeys();
  };

  const [connections, setConnections] = useState<{ id: string; host: string; port: string; username: string; keyName: string; password?: boolean }[]>([]);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [keyName, setKeyName] = useState("");
  const [password, setPassword] = useState("");

  const refreshConnections = async () => {
    const res = await fetch("/api/vps/connections");
    const data = await res.json();
    setConnections(data);
  };

  useEffect(() => {
    refreshKeys();
    refreshConnections();
  }, []);

  const handleAddConnection = async () => {
    await fetch("/api/vps/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port, username, keyName, password }),
    });
    setHost("");
    setPort("22");
    setUsername("root");
    setKeyName("");
    setPassword("");
    refreshConnections();
  };

  return (
    <div className="p-4 bg-gray-50 h-full overflow-y-auto">
      <h2 className="text-lg font-bold mb-4">SSH Key Management</h2>
      <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
        <input className="w-full p-2 mb-2 border rounded" placeholder="Key name" value={name} onChange={e => setName(e.target.value)} />
        <textarea className="w-full p-2 mb-2 border rounded font-mono text-xs" placeholder="Private Key (-----BEGIN...)" value={key} onChange={e => setKey(e.target.value)} rows={5} />
        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700" onClick={handleAddKey}>Add Key</button>
      </div>
      <div className="space-y-2">
        {keys.map((k) => (
          <div key={k.id} className="p-3 border border-gray-200 rounded-lg flex justify-between items-center bg-white">
            <span className="font-medium text-sm">{k.name} {k.isDefault && <span className="text-xs text-blue-600 ml-1">(Default)</span>}</span>
            <div className="flex gap-2">
              {!k.isDefault && <button className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-2 py-1 rounded" onClick={() => handleSetDefault(k.id)}>Set Default</button>}
              <button className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded" onClick={() => handleDeleteKey(k.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-4 mt-8">VPS Connection Management</h2>
      <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <input className="col-span-2 p-2 border rounded" placeholder="Host" value={host} onChange={e => setHost(e.target.value)} />
          <input className="p-2 border rounded" placeholder="Port" value={port} onChange={e => setPort(e.target.value)} />
          <input className="p-2 border rounded" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="col-span-2 p-2 border rounded" placeholder="Key name" value={keyName} onChange={e => setKeyName(e.target.value)} />
          <input className="col-span-2 p-2 border rounded" type="password" placeholder="Password (optional)" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button className="mt-3 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 w-full" onClick={handleAddConnection}>Add Connection</button>
      </div>
      <div className="space-y-2">
        {connections.map((c) => (
          <div key={c.id} className="p-3 border border-gray-200 rounded-lg bg-white">
            <div className="font-semibold text-sm text-gray-800">{c.username}@{c.host}:{c.port}</div>
            <div className="text-xs text-gray-500">Key: {c.keyName} {c.password ? "(with password)" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
