import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePhotonicsP2, validatePhotonicsP2, PHOTONICS_P2_MAX_BYTES} from '../src/photonics-p2.js';

function record(method) {
  const m = {input_transfer_ms:null,preprocess_ms:.5,interstage_to_cpu_ms:null,
    reservoir_ms:1,interstage_to_cuda_ms:null,ridge_readout_ms:.5};
  return {accuracy:.5,confusion_actual_rows_predicted_columns:[[4,4],[4,4]],
    held_out_samples:16,feature_dimensions:16,
    route:['cpu','cpu','cpu'],nonlinearity:method.endsWith('sine')?'sine':'tanh',
    stage_ms:m,wall_ms:method==='cpu_sine'?3:4,transfer_bytes:0,
    peak_incremental_cuda_allocated_bytes:null,
    max_abs_feature_drift_from_cpu:null};
}
function fixture() {
  const methods=['cpu_sine','cpu_tanh'];
  const tasks={};
  for(const task of ['temporal_xor','first_pulse_memory']) {
    const runs=Array.from({length:3},(_,i)=>({
      seed:369+i,method_execution_order:i%2?['cpu_tanh','cpu_sine']:methods,
      methods:Object.fromEntries(methods.map(m=>[m,record(m)]))
    }));
    tasks[task]={
      runs,
      aggregate:{
        cpu_sine:{mean_held_out_accuracy:.5,median_wall_ms:3},
        cpu_tanh:{mean_held_out_accuracy:.5,median_wall_ms:4},
      },
      paired_comparisons:[{
        baseline:'cpu_sine',candidate:'cpu_tanh',paired_seed_count:3,
        median_candidate_minus_baseline_ms:1,
        exploratory_bootstrap_95pct_median_delta_ms:[1,1],bootstrap_resamples:1000
      }]
    };
  }
  return {
    schema:'phicore369.photonics.p2.v1',source:'measured-local-pytorch-digital',
    created_at:'2026-11-06T02:00:00Z',
    research_reference:{replication_of_paper:false},
    environment:{python:'3.12',pytorch:'2.10',device:'cpu',cuda_available:false},
    protocol:{
      tasks:['temporal_xor','first_pulse_memory'],samples:64,steps:8,
      virtual_nodes:8,repeats_per_task:3,initial_seed:369,ridge_lambda:.1,
      methods,train_fraction:.75,precision:'float32',
      projection:'seeded_identity_plus_small_gaussian',
      randomization:'fixed_seed_per_task_per_round_shuffle',
      pairing:'same_task_seed_input_train_test_split',
      warmup:'one_complete_full_route_per_method_and_seed',
      bootstrap_resamples:1000
    },tasks,
    hardware:{actual_optical_device:false,power_measured:false},
    limits:['All execution uses electronic CPU/CUDA PyTorch, never optical equipment.'],
    interfaces:{execution_authorized:false}
  };
}
const copy=obj=>JSON.parse(JSON.stringify(obj));

test('accepts internally consistent paired CPU-only results',()=>{
  const report=fixture();
  assert.equal(validatePhotonicsP2(report),report);
  assert.deepEqual(parsePhotonicsP2(JSON.stringify(report)),report);
});
test('rejects nonexistent optical hardware and permissions',()=>{
  const report=fixture();report.hardware.actual_optical_device=true;
  assert.throws(()=>validatePhotonicsP2(report),/hardware/);
  const other=fixture();other.interfaces.execution_authorized=true;
  assert.throws(()=>validatePhotonicsP2(other),/execute|execution|authorize/);
});
test('rejects mismatched trial order and raw-data aggregates',()=>{
  const report=fixture();report.tasks.temporal_xor.runs[0].method_execution_order=['cpu_sine','cpu_sine'];
  assert.throws(()=>validatePhotonicsP2(report),/order/);
  const other=fixture();other.tasks.first_pulse_memory.aggregate.cpu_sine.median_wall_ms=1;
  assert.throws(()=>validatePhotonicsP2(other),/aggregate/);
});
test('rejects invented paired delta and confidence bounds',()=>{
  const report=fixture();report.tasks.temporal_xor.paired_comparisons[0].median_candidate_minus_baseline_ms=19;
  assert.throws(()=>validatePhotonicsP2(report),/comparison/);
  const other=fixture();other.tasks.temporal_xor.paired_comparisons[0].exploratory_bootstrap_95pct_median_delta_ms=[-10,10];
  assert.throws(()=>validatePhotonicsP2(other),/interval/);
});
test('rejects bad stage and confusion stats through P1 validator',()=>{
  const report=fixture();report.tasks.temporal_xor.runs[0].methods.cpu_tanh.stage_ms.reservoir_ms=-1;
  assert.throws(()=>validatePhotonicsP2(report),/stage/);
  const other=fixture();other.tasks.temporal_xor.runs[0].methods.cpu_tanh.accuracy=.9;
  assert.throws(()=>validatePhotonicsP2(other),/accuracy/);
});
test('refuses malformed and oversized local imports',()=>{
  assert.throws(()=>parsePhotonicsP2('x'.repeat(PHOTONICS_P2_MAX_BYTES+1)),/256 KiB/);
  assert.throws(()=>parsePhotonicsP2('{oops'),/malformed/);
});
