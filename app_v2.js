const { useState, useRef, useEffect } = React;

const APP_VERSION = "1.1.0";

function App() {
    const [fileData, setFileData] = useState(null);
    const [isParsing, setIsParsing] = useState(false);
    const [results, setResults] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'risk', direction: 'desc' });
    const [refDb, setRefDb] = useState({});
    const [dbLoading, setDbLoading] = useState(true);
    const [showNormal, setShowNormal] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        // Fetch the static reference database built by the Python script
        fetch('ref_db.json?v=' + new Date().getTime())
            .then(res => res.json())
            .then(data => {
                setRefDb(data);
                setDbLoading(false);
            })
            .catch(err => {
                console.error('Error loading reference DB:', err);
                setDbLoading(false);
            });
    }, []);

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        setIsParsing(true);
        const reader = new FileReader();
        
        reader.onload = (event) => {
            const text = event.target.result;
            // Basic parsing logic for 23andMe/Ancestry (TSV)
            const lines = text.split('\n');
            const parsedResults = [];
            
            lines.forEach(line => {
                if (line.startsWith('#') || !line.trim()) return;
                
                // 23andMe format: rsid, chromosome, position, genotype
                // Ancestry format: rsid, chromosome, position, allele1, allele2
                const parts = line.split('\t');
                let rsid, chromosome, position, genotype;
                
                if (parts.length === 4) {
                    // 23andMe
                    [rsid, chromosome, position, genotype] = parts;
                } else if (parts.length === 5) {
                    // Ancestry
                    [rsid, chromosome, position] = parts;
                    genotype = parts[3] + parts[4];
                } else {
                    // CSV fallback or other format
                    const csvParts = line.split(',');
                    if (csvParts.length >= 4) {
                        rsid = csvParts[0].replace(/"/g, '');
                        chromosome = csvParts[1].replace(/"/g, '');
                        genotype = csvParts[3].replace(/"/g, '');
                    } else {
                        return;
                    }
                }
                
                // Trim in case of weird whitespace
                rsid = rsid?.trim();
                
                if (rsid && refDb[rsid]) {
                    const dbEntry = refDb[rsid];
                    let finalRisk = 'normal';
                    
                    // Simple strand match check
                    if (genotype && dbEntry.risk_allele && genotype.includes(dbEntry.risk_allele)) {
                        finalRisk = dbEntry.risk;
                    }

                    parsedResults.push({
                        rsid,
                        chromosome: chromosome?.trim(),
                        position: position?.trim(),
                        genotype: genotype?.trim(),
                        ...dbEntry,
                        risk: finalRisk
                    });
                }
            });
            
            setResults(parsedResults);
            setFileData(file.name);
            setIsParsing(false);
        };
        
        reader.readAsText(file);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        
        const sorted = [...results].sort((a, b) => {
            const valA = a[key] || '';
            const valB = b[key] || '';
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        
        setResults(sorted);
    };

    return (
        <div className="container">
            <header>
                <h1>DNA Health Analyzer</h1>
                <p>Secure, local browser analysis of your genetic data.</p>
                {!dbLoading && refDb['_metadata'] && (
                    <p style={{fontSize: '0.8rem', color: '#94a3b8', marginTop: '-0.5rem'}}>
                        App Version: v{APP_VERSION} | ClinVar Database: {refDb['_metadata'].last_updated}
                    </p>
                )}
            </header>
            
            <main>
                {!fileData ? (
                    <div className="card">
                        {dbLoading ? (
                            <p style={{textAlign: 'center'}}>Loading Genomic Reference Database...</p>
                        ) : (
                            <div 
                                className="upload-area"
                                onClick={() => fileInputRef.current.click()}
                            >
                                <input 
                                    type="file" 
                                    className="hidden-input" 
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".txt,.csv,.tsv"
                                />
                                <h3>Upload your DNA Data</h3>
                                <p>Supports 23andMe, AncestryDNA, and FamilyTreeDNA formats.</p>
                                <button>Select File</button>
                            </div>
                        )}
                        <p style={{marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem', color: '#94a3b8'}}>
                            <strong>Privacy Guarantee:</strong> All processing is done locally in your browser. Your DNA data never leaves your device.
                        </p>
                    </div>
                ) : (
                    <div className="card">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <h2>Analysis Results for {fileData}</h2>
                            <div style={{display: 'flex', alignItems: 'center'}}>
                                <label style={{marginRight: '1rem', display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9rem', color: '#94a3b8'}}>
                                    <input 
                                        type="checkbox" 
                                        checked={showNormal} 
                                        onChange={(e) => setShowNormal(e.target.checked)} 
                                        style={{marginRight: '0.5rem'}}
                                    />
                                    Show Normal/Benign
                                </label>
                                <button onClick={() => setFileData(null)} style={{marginRight: '1rem', background: '#475569'}}>Analyze Another</button>
                                <button onClick={() => window.print()}>Print Report</button>
                            </div>
                        </div>
                        
                        {isParsing ? (
                            <p>Parsing DNA data locally...</p>
                        ) : (
                            <div style={{overflowX: 'auto'}}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th onClick={() => handleSort('rsid')}>RSID ↕</th>
                                            <th onClick={() => handleSort('chromosome')}>Chromosome ↕</th>
                                            <th onClick={() => handleSort('genotype')}>Your Genotype ↕</th>
                                            <th onClick={() => handleSort('trait')}>Associated Trait ↕</th>
                                            <th onClick={() => handleSort('risk')}>Risk Level ↕</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.filter(item => showNormal || item.risk !== 'normal').map((item, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <a 
                                                        href={`https://www.snpedia.com/index.php/${item.rsid}`} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        style={{color: '#3b82f6', textDecoration: 'none', fontWeight: '500'}}
                                                    >
                                                        {item.rsid}
                                                    </a>
                                                </td>
                                                <td>{item.chromosome}</td>
                                                <td><strong>{item.genotype}</strong></td>
                                                <td>{item.trait}</td>
                                                <td>
                                                    <span className={`badge badge-${item.risk}`}>
                                                        {item.risk}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                        {results.length === 0 && (
                                            <tr>
                                                <td colSpan="5" style={{textAlign: 'center', padding: '2rem', color: '#94a3b8'}}>
                                                    No known traits found in this sample data.<br/>
                                                    (Note: Currently using a small mock database for demonstration)
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
