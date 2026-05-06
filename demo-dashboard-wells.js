import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { 
  Activity, Droplets, AlertTriangle, ArrowUpRight, ArrowDownRight, 
  Database, RefreshCw, Filter
} from 'lucide-react';

// Färgpalett för de 10 brunnarna för att skilja dem åt i grafer
const WELL_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#64748b'
];

export default function App() {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Simulerar hämtning av data från din databas
  const fetchData = () => {
    setIsLoading(true);
    // HÄR: Byt ut denna timeout mot din riktiga databasanrop (t.ex. fetch('/api/wells'))
    setTimeout(() => {
      const days = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
      const wells = Array.from({ length: 10 }, (_, i) => `Brunn ${i + 1}`);
      
      const mockData = days.map(day => {
        const dayData = { name: day };
        let total = 0;
        wells.forEach((well, index) => {
          // Genererar ett realistiskt flöde (m³ per dag) med lite variation
          const baseFlow = 20 + (index * 5); 
          const variation = Math.floor(Math.random() * 15) - 5;
          const flow = Math.max(0, baseFlow + variation);
          
          dayData[well] = flow;
          total += flow;
        });
        dayData.total = total;
        return dayData;
      });

      setData(mockData);
      setIsLoading(false);
    }, 800);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Bearbetar data för att skapa individuella summeringar för brunnskorten
  const wellSummaries = useMemo(() => {
    if (data.length === 0) return [];
    
    const wells = Object.keys(data[0]).filter(k => k !== 'name' && k !== 'total');
    
    return wells.map((well, index) => {
      const wellData = data.map(d => ({ name: d.name, value: d[well] }));
      const totalFlow = wellData.reduce((sum, d) => sum + d.value, 0);
      const currentFlow = wellData[wellData.length - 1].value;
      const previousFlow = wellData[wellData.length - 2].value;
      const trend = currentFlow - previousFlow;
      
      // Enkel logik för status: onormalt lågt/högt flöde kan trigga en varning
      const average = totalFlow / 7;
      let status = 'normal';
      if (currentFlow < average * 0.5) status = 'low';
      if (currentFlow > average * 1.5) status = 'high';

      return {
        name: well,
        data: wellData,
        total: totalFlow,
        current: currentFlow,
        trend,
        status,
        color: WELL_COLORS[index]
      };
    });
  }, [data]);

  // Totala systemvärden för top-KPI:er
  const systemTotal = wellSummaries.reduce((sum, w) => sum + w.total, 0);
  const systemCurrent = wellSummaries.reduce((sum, w) => sum + w.current, 0);
  const activeAlerts = wellSummaries.filter(w => w.status !== 'normal').length;

  if (isLoading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="flex flex-col items-center text-slate-500">
          <RefreshCw className="w-8 h-8 animate-spin mb-4" />
          <p>Laddar data från brunnar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-6 h-6 text-blue-600" />
              Översikt Vattenmätarbrunnar
            </h1>
            <p className="text-slate-500 text-sm">Flödesdata för de senaste 7 dagarna (m³)</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Uppdatera
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm text-sm font-medium hover:bg-blue-700 transition-colors">
              <Filter className="w-4 h-4" />
              Filtrera
            </button>
          </div>
        </header>

        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Totalt systemflöde (7 dgr)</p>
              <h3 className="text-3xl font-bold text-slate-900 mt-1">{systemTotal.toLocaleString()} <span className="text-lg font-normal text-slate-500">m³</span></h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Droplets className="w-6 h-6" />
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Aktuellt dygnsflöde</p>
              <h3 className="text-3xl font-bold text-slate-900 mt-1">{systemCurrent.toLocaleString()} <span className="text-lg font-normal text-slate-500">m³/dag</span></h3>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
              <Activity className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Systemstatus</p>
              <div className="flex items-center gap-2 mt-1">
                <h3 className="text-3xl font-bold text-slate-900">
                  {activeAlerts === 0 ? 'Normal' : `${activeAlerts} Avvikelser`}
                </h3>
              </div>
            </div>
            <div className={`p-3 rounded-lg ${activeAlerts > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-600'}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Main Chart - Samlat flöde */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900">Övergripande Flödestrend</h2>
            <p className="text-sm text-slate-500">Samtliga brunnar kombinerade</p>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '4px' }}
                />
                {wellSummaries.map((well) => (
                  <Line 
                    key={well.name}
                    type="monotone" 
                    dataKey={well.name} 
                    stroke={well.color} 
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Grid med individuella brunnar */}
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Individuella Brunnar</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {wellSummaries.map((well) => (
              <div key={well.name} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: well.color }}></div>
                    <h3 className="font-semibold text-slate-900">{well.name}</h3>
                  </div>
                  {well.status !== 'normal' && (
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                  )}
                </div>
                
                <div className="flex items-end gap-2 mb-4">
                  <span className="text-2xl font-bold text-slate-900">{well.current}</span>
                  <span className="text-sm text-slate-500 mb-1">m³/d</span>
                  <div className={`flex items-center text-sm mb-1 ml-auto ${well.trend > 0 ? 'text-emerald-600' : well.trend < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {well.trend > 0 ? <ArrowUpRight className="w-4 h-4" /> : well.trend < 0 ? <ArrowDownRight className="w-4 h-4" /> : null}
                    <span>{Math.abs(well.trend)}</span>
                  </div>
                </div>

                <div className="h-16 w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={well.data}>
                      <defs>
                        <linearGradient id={`color-${well.name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={well.color} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={well.color} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke={well.color} 
                        fillOpacity={1} 
                        fill={`url(#color-${well.name})`} 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}