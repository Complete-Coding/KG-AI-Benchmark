const Logo = () => {
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 text-white text-xl font-bold tracking-tight shadow-inner">
        KG
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-semibold text-white">Knowledge Gate</span>
        <span className="text-sm text-white/70">AI Benchmark</span>
      </div>
    </div>
  );
};

export default Logo;
