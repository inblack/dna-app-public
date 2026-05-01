const { useState, useRef, useEffect } = React;

const APP_VERSION = "1.4.0";

const COMPLEMENT = { A: 'T', T: 'A', C: 'G', G: 'C' };

// Count how many copies of the risk allele the genotype contains,
// accounting for strand flips.
function countRiskAlleles(genotype, riskAllele, refAllele) {
    if (!genotype || !riskAllele) return 0;
    const gt = genotype.trim().toUpperCase().split('');
    const risk = riskAllele.toUpperCase();
    const ref  = (refAllele || '').toUpperCase();

    const compRisk = COMPLEMENT[risk];
    const compRef  = COMPLEMENT[ref];
    // Determine if we need to check complement (strand flip)
    const useComplement = compRisk && compRef && compRisk !== ref;

    return gt.filter(a => a === risk || (useComplement && a === compRisk)).length;
}

// Classify risk based on zygosity and chromosome.
// sex: 'male' | 'female'
// chromosome: raw string from the DNA file ('1'..'22', 'X'/'23', 'MT'/'26')
function classifyRisk(dbEntry, genotype, chromosome, sex) {
    const copies = countRiskAlleles(genotype, dbEntry.risk_allele, dbEntry.ref_allele);
    if (copies === 0) return 'normal';

    const chrom = (chromosome || '').trim().toUpperCase();
    const isXLinked = chrom === 'X' || chrom === '23';
    const isMito    = chrom === 'MT' || chrom === '26';

    // Mitochondrial: any presence = use DB risk level
    if (isMito) return dbEntry.risk;

    // X-linked in males: hemizygous → full risk
    if (isXLinked && sex === 'male') return dbEntry.risk;

    // Homozygous for risk allele → full risk
    if (copies >= 2) return dbEntry.risk;

    // Heterozygous: one copy = carrier (relevant for recessive; dominant would still be high)
    // We can't easily know dominance from ClinVar TSV, so flag as 'carrier' to avoid false alarms
    return 'carrier';
}

// Category priority order for display
const CATEGORY_ORDER = [
    'Blood & Hematology',
    'Cardiovascular',
    'Cancer Risk',
    'Drug Response',
    'Neurological',
    'Metabolic & Endocrine',
    'Immune & Infectious Disease',
    'Nutrition & Metabolism',
    'Musculoskeletal',
    'Sensory',
    'Other',
];

const RISK_ORDER = { high: 0, carrier: 1, medium: 2, low: 3, normal: 4 };

function getCategory(trait) {
    const t = (trait || '').toLowerCase();
    if (/hemochromat|anemia|iron|thalassemia|sickle|coagulat|thrombosis|thrombophilia|hemoglobin|platelet|factor v|bleeding|polycythemia/.test(t)) return 'Blood & Hematology';
    if (/cholesterol|lipid|lipodystrophy|coronary|cardiac|cardiomy|arrhythmia|heart|aortic|vascular|hypertension|blood pressure|atrial|brugada|long qt/.test(t)) return 'Cardiovascular';
    if (/cancer|tumor|carcinoma|neoplasm|polyposis|melanoma|brca|lynch|adenomatous|mesothelioma|exostosis|paraganglioma|pheochromocy/.test(t)) return 'Cancer Risk';
    if (/drug response|pharmacogenomic|capecitabine|fluorouracil|warfarin|clopidogrel|levothyroxine|statin|codeine|tamoxifen/.test(t)) return 'Drug Response';
    if (/epilepsy|seizure|neuropathy|neurofibromatosis|neurological|brain|dystonia|leigh|parkinson|alzheimer|dementia|ataxia|deafness dystonia|spongy/.test(t)) return 'Neurological';
    if (/diabetes|thyroid|parathyroid|hormone|adrenal|hyperparathyroid|insulin|growth hormone|cushings/.test(t)) return 'Metabolic & Endocrine';
    if (/leprosy|immune|autoimmune|lupus|rheuma|infectious|hiv|hepatitis|susceptibility to/.test(t)) return 'Immune & Infectious Disease';
    if (/folate|vitamin|amino acid|citrullin|pyridoxine|methylmalonic|homocystinuria|phenylketonuria|galactosemia/.test(t)) return 'Nutrition & Metabolism';
    if (/muscle|exostosis|skeletal|bone|arthritis|ehlers|marfan|connective tissue/.test(t)) return 'Musculoskeletal';
    if (/deaf|hearing|vision|eye|retinal|optic|macular/.test(t)) return 'Sensory';
    return 'Other';
}

function App() {
    const [fileData, setFileData] = useState(null);
    const [isParsing, setIsParsing] = useState(false);
    const [results, setResults] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'risk', direction: 'desc' });
    const [refDb, setRefDb] = useState({});
    const [dbLoading, setDbLoading] = useState(true);
    const [showNormal, setShowNormal] = useState(false);
    const [sex, setSex] = useState('male');
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
                    const finalRisk = classifyRisk(dbEntry, genotype, chromosome, sex);

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
                            <>
                                <div style={{textAlign: 'center', marginBottom: '1rem'}}>
                                    <label style={{fontSize: '0.9rem', color: '#94a3b8', marginRight: '0.75rem'}}>Biological Sex:</label>
                                    <select
                                        id="sex-selector"
                                        value={sex}
                                        onChange={e => setSex(e.target.value)}
                                        style={{background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.9rem'}}
                                    >
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                    </select>
                                </div>
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
                            </>
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
                                    Show Normal Results
                                </label>
                                <button onClick={() => setFileData(null)} style={{marginRight: '1rem', background: '#475569'}}>Analyze Another</button>
                                <button onClick={() => window.print()}>Print Report</button>
                            </div>
                        </div>
                        
                        {isParsing ? (
                            <p>Parsing DNA data locally...</p>
                        ) : (() => {
                            const filtered = results.filter(item => showNormal || item.risk !== 'normal');
                            if (filtered.length === 0) {
                                return <p style={{textAlign: 'center', color: '#94a3b8', padding: '2rem'}}>No variants found matching your filters.</p>;
                            }

                            // Group by category
                            const grouped = {};
                            filtered.forEach(item => {
                                const cat = getCategory(item.trait);
                                if (!grouped[cat]) grouped[cat] = [];
                                grouped[cat].push(item);
                            });

                            // Sort within each group by risk severity
                            Object.values(grouped).forEach(items => {
                                items.sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9));
                            });

                            const sortedCategories = CATEGORY_ORDER.filter(c => grouped[c]);
                            const remainingCats = Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c));

                            return [...sortedCategories, ...remainingCats].map(category => (
                                <div key={category} style={{marginBottom: '2rem'}}>
                                    <h3 style={{
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        color: '#94a3b8',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        borderBottom: '1px solid #334155',
                                        paddingBottom: '0.5rem',
                                        marginBottom: '0',
                                    }}>{category} <span style={{fontWeight: 400, fontSize: '0.8rem'}}>({grouped[category].length})</span></h3>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th onClick={() => handleSort('rsid')}>RSID ↕</th>
                                                <th onClick={() => handleSort('chromosome')}>Chr ↕</th>
                                                <th onClick={() => handleSort('genotype')}>Genotype ↕</th>
                                                <th onClick={() => handleSort('trait')}>Condition ↕</th>
                                                <th onClick={() => handleSort('risk')}>Status ↕</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {grouped[category].map((item, idx) => (
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
                                                    <td style={{fontSize: '0.9rem'}}>
                                                        {item.risk === 'carrier'
                                                            ? <><span style={{color: '#a78bfa', fontWeight: 500}}>Carrier for: </span>{item.trait}</>
                                                            : item.trait
                                                        }
                                                    </td>
                                                    <td>
                                                        <span className={`badge badge-${item.risk}`}>
                                                            {item.risk === 'carrier' ? 'Carrier' : item.risk}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </main>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
