# Streaming

protogen generates all four gRPC RPC kinds, using grpc-go's generics-based stream types (the shape `protoc-gen-go-grpc` v1.6+ emits).

```proto
service Chat {
  rpc Send(Message) returns (Ack);                        // unary
  rpc Subscribe(SubscribeRequest) returns (stream Message);   // server streaming
  rpc Upload(stream Chunk) returns (UploadSummary);       // client streaming
  rpc Converse(stream Message) returns (stream Message);  // bidirectional
}
```

## Generated gRPC

The client interface and server interface adapt to each kind:

```go
type ChatClient interface {
	Send(ctx context.Context, in *Message, opts ...grpc.CallOption) (*Ack, error)
	Subscribe(ctx context.Context, in *SubscribeRequest, opts ...grpc.CallOption) (grpc.ServerStreamingClient[Message], error)
	Upload(ctx context.Context, opts ...grpc.CallOption) (grpc.ClientStreamingClient[Chunk, UploadSummary], error)
	Converse(ctx context.Context, opts ...grpc.CallOption) (grpc.BidiStreamingClient[Message, Message], error)
}

type ChatServer interface {
	Send(context.Context, *Message) (*Ack, error)
	Subscribe(*SubscribeRequest, grpc.ServerStreamingServer[Message]) error
	Upload(grpc.ClientStreamingServer[Chunk, UploadSummary]) error
	Converse(grpc.BidiStreamingServer[Message, Message]) error
	mustEmbedUnimplementedChatServer()
}
```

The `ServiceDesc` places unary methods in `Methods` and streaming methods in `Streams` with the correct `ServerStreams`/`ClientStreams` flags — so the code works against the standard grpc-go runtime unchanged.

## Streaming over the gateway

Only **server-streaming** methods can be exposed over REST. When a server-streaming method has a `google.api.http` binding, the gateway forwards each message as a chunked JSON stream (`runtime.ForwardResponseStream`):

```proto
rpc Subscribe(SubscribeRequest) returns (stream Message) {
  option (google.api.http) = { get: "/v1/rooms/{room}/messages" };
}
```

```txt
GET /v1/rooms/general/messages
{"result":{"room":"general","text":"msg 0"}}
{"result":{"room":"general","text":"msg 1"}}
...
```

Notes:

- The in-process `Register<Service>HandlerServer` path returns `Unimplemented` for streaming methods (matching protoc-gen-grpc-gateway); use `Register<Service>Handler` over a real connection for streaming.
- **Client-streaming and bidirectional** methods have no REST representation, so the gateway skips them (it prints a note to stderr). They remain fully available over gRPC.
- `additional_bindings` are out of scope.
