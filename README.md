# WARNING
This is an early bodgy version of what I had in mind. Use with care.

## express-postman-router
Automatically create postman collections from source code. 

## usage

    const api = new ApiRouter(
    {	
      folder: "test-folder",
      mountpath: "/",
      host: "ifmacinema.com",
	  postman: 
	  {
	  	collection_uid: "<collection_uid>",
		apikey: "<your postman api key>"
	  }
    })

    api.add(
    {

      name: "Test Request",
      description: "This is a test generated by the express-postman-router",

      method: "POST",

      params:
      {
        username: 
        {
          required: true,
          type: "string",
          description: "Some description"
        },
        password:
        {
          required: true,
          type: "string"
        }
      },

      route: "/this/is/a/test",
      callback: (req, res, next) =>
      {
        console.log(req.body)
      }
    })
	
  	api.updatePostman()
