/*instrumentation.ts*/
import { NodeSDK } from "@opentelemetry/sdk-node";
//import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://jaeger:4318/v1/traces",
  }),
  metricReader: new PrometheusExporter({
    port: 9464,
    //host: "0.0.0.0",
  }),
  instrumentations: [
    //getNodeAutoInstrumentations(),
    //new HttpInstrumentation(),
    //new ExpressInstrumentation(),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "github-analytics-api",
    [ATTR_SERVICE_VERSION]: '1.0',
  }),
});

sdk.start();
