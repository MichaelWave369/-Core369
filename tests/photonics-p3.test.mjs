import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePhotonicsP2, comparePhotonicsP2Texts, PHOTONICS_P3_SCHEMA} from '../src/photonics-p3.js';

const makeMethod=(name,shift=0)=>{
  const base=name==='cpu_sine'?3:4;
  return {
    accuracy:.5,
    confusion_actual_rows_predicted_columns:[[4,4],[4,4]],
    held_out_samples:16,
    feature_dimensions:16,
    route:['cpu','cpu','cpu'],
    nonlinearity:name.endsWith('sine')?'sine':'tanh',
    stage_ms:{input_transfer_ms:null,preprocess_ms:.5,
      interstage_to_cpu_ms:null,reservoir_ms:1,
      interstage_to_cuda_ms:null,ridge_readout_ms:.5},
    wall_ms:base+shift*(name==='cpu_sine'?1:2),
    transfer_bytes:0,peak_incremental_cuda_allocated_bytes:null,
    max_abs_feature_drift_from_cpu:null
  };
};

function report(shift=0,when='2026-11-06T03:00:00Z') {
  const methods=['cpu_sine','cpu_tanh'];
  const tasks={};
  for(const task of ['temporal_xor','first_pulse_memory']){
    const runs=Array.from({length:3},(_,i)=>({
      seed:369+i,
      method_execution_order: i%2?['cpu_tanh','cpu_sine']:methods,
      methods:{cpu_sine:makeMethod('cpu_sine',shift),
        cpu_tanh:makeMethod('cpu_tanh',shift)}
    }));
    const delta=1+shift;
    tasks[task]={
      runs,
      aggregate:{
        cpu_sine:{mean_held_out_accuracy:.5,median_wall_ms:3+shift},
        cpu_tanh:{mean_held_out_accuracy:.5,median_wall_ms:4+shift*2}
      },
      paired_comparisons:[{
        baseline:'cpu_sine',candidate:'cpu_tanh',paired_seed_count:3,
        median_candidate_minus_baseline_ms:delta,
        exploratory_bootstrap_95pct_median_delta_ms:[delta,delta],
        bootstrap_resamples:1000
      }]
    };
  }
  return {
    schema:'phicore369.photonics.p2.v1',
    source:'measured-local-pytorch-digital',created_at:when,
    research_reference:{replication_of_paper:false},
    environment:{
      python:'3.12',pytorch:'2.10',os:'Windows 11 test',cpu:'Intel test CPU',
      cpu_threads:8,device:'cpu',cuda_available:false,gpu_name:null,cuda_runtime:null
    },
    protocol:{
      tasks:['temporal_xor','first_pulse_memory'],
      samples:64,steps:8,virtual_nodes:8,repeats_per_task:3,
      initial_seed:369,ridge_lambda:.1,methods,train_fraction:.75,
      precision:'float32',projection:'seeded_identity_plus_small_gaussian',
      warmup:'one_complete_full_route_per_method_and_seed',
      randomization:'fixed_seed_per_task_per_round_shuffle',
      pairing:'same_task_seed_input_train_test_split',bootstrap_resamples:1000
    },
    tasks,
    hardware:{actual_optical_device:false,power_measured:false},
    limits:['All execution uses electronic CPU/CUDA PyTorch, never optical equipment.'],
    interfaces:{execution_authorized:false}
  };
}
const copy=x=>JSON.parse(JSON.stringify(x));

test('compares two matching numeric sessions without declaring proof',()=>{
  const a=report(),b=report(.1,'2026-11-06T04:00:00Z');
  const result=comparePhotonicsP2(a,b);
  assert.equal(result.schema,PHOTONICS_P3_SCHEMA);
  assert.equal(result.evidence_status,'exploratory_two_sessions_not_hardware_verification');
  assert.equal(result.session_count,2);
  assert.equal(result.optical_hardware_measured,false);
  assert.equal(result.measured_energy,false);
  assert.equal(result.independent_sessions_authenticated,false);
  assert.equal(result.results.length,4);
  assert.equal(result.paired_effects.length,2);
  assert.equal(result.warnings.length,0);
  assert.deepEqual(comparePhotonicsP2Texts(JSON.stringify(a),JSON.stringify(b)),result);
});
test('warns for timing drift instead of claiming verification',()=>{
  const a=report(),b=report(1,'2026-11-06T04:00:00Z');
  const result=comparePhotonicsP2(a,b);
  assert(result.warnings.length>0);
  assert(result.results.some(x=>x.flagged_for_review));
});
test('rejects mismatched machine metadata',()=>{
  const a=report(),b=report(.1,'2026-11-06T04:00:00Z');
  b.environment.cpu_threads=4;
  assert.throws(()=>comparePhotonicsP2(a,b),/metadata differs/);
});
test('rejects mismatched workload and seeds',()=>{
  const a=report(),b=report(.1,'2026-11-06T04:00:00Z');
  b.protocol.ridge_lambda=.2;
  assert.throws(()=>comparePhotonicsP2(a,b),/protocol differ/);
});
test('rejects unidentifiable duplicates and missing host provenance',()=>{
  const a=report(),b=copy(a);
  assert.throws(()=>comparePhotonicsP2(a,b),/identical creation/);
  b.created_at='2026-11-06T04:00:00Z';
  assert.throws(()=>comparePhotonicsP2(a,b),/identical/);
  b.tasks.temporal_xor.runs[0].methods.cpu_sine.wall_ms=3.01;
  b.tasks.temporal_xor.aggregate.cpu_sine.median_wall_ms=3;
  delete b.environment.os;
  assert.throws(()=>comparePhotonicsP2(a,b),/missing P3 host/);
});
test('refuses malformed or optical-hardware reports',()=>{
  const a=report(),b=report(.1,'2026-11-06T04:00:00Z');
  b.hardware.actual_optical_device=true;
  assert.throws(()=>comparePhotonicsP2(a,b),/hardware/);
});
