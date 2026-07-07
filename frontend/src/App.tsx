import WorkCenter from "./components/WorkCenter";
function App() {
  return (
    <>
      <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
        <h1 className="text-3xl font-bold">Factory Simulator</h1>
        <div className="flex gap-4">
          <WorkCenter name="Raw Material" queueCount={10} status="Idle" />
          <WorkCenter name="Cutter" queueCount={5} status="Busy" />
          <WorkCenter name="Finisher" queueCount={0} status="Idle" />
        </div>
        <button className="bg-blue-500 text-white p-2 rounded-lg">
          Start Simulation
        </button>
      </div>
    </>
  );
}

export default App;
