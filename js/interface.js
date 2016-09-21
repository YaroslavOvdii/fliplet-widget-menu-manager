(function () {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu')
  };

  var topMenu = Fliplet.App.Settings.get('topMenu') || { id: 'pages' };
  var $appMenu = $('#app-menu');

  var currentDataSource;

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  var menusPromises = {};

  Fliplet.DataSources.get({ type: 'menu' })
    .then(function (dataSources) {
      if (dataSources.length === 0) {
        $("#initial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function (dataSource) {
        addMenu(dataSource);
      });

      $appMenu
        .val(topMenu.id)
        .change(function () {
          var value = $(this).val();
          topMenu.id = value;
          Fliplet.App.Settings.set({ topMenu: topMenu }).then(function () {
            Fliplet.Studio.emit('reload-page-preview');
          });
        });

      console.log('Data Sources: ', dataSources);
    });

  // Listeners
  $('.add-menu').on('click', function () {
    Fliplet.DataSources.create({ name: 'Menu Title', type: 'menu' })
      .then(function (dataSource) {
        addMenu(dataSource);

        $('#select-menu').val(dataSource.id).change();
        $("#panel-holder").show();
      })

  });

  $('#add-link').on('click', function () {
    currentDataSource.insert()
      .then(function (row) {
        addLink(currentDataSource.id, row)
      })
  });

  $('#delete-menu').on('click', function () {
    var menuId = getSelectedMenuId();
    Fliplet.DataSources.delete(menuId)
      .then(function () {
        $("#select-menu option[value='"+menuId+"']").remove();
      })

    $('#select-menu').val(0).change();
  });


  $("#accordion")
    .on('click', '.icon-delete', function() {
      var $item = $(this).closest("[data-id], .panel"),
        id = $item.data('id');

      $item.remove();

      currentDataSource.removeById(id)
        .then(function (row) {
        })
    });


  $('#select-menu, #app-menu').on('change', function onMenuChange() {
    var selectedText = $(this).find("option:selected").text();
    $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);

    // Change visible links
    var menuId = $(this).val();
    if (menuId === "0") {
      $('#menu-name-group').hide();
    } else {
      $('#menu-name-group').show();
    }

    $('#accordion .menu').hide();
    $('#menu-' + menuId).show();

    // Change menu name on input
    var menuName = getSelectedMenuName();
    setMenuName(menuName);

    // Set current data source
    if (menuId == "0") {
      currentDataSource = null;
    } else {
      Fliplet.DataSources.connect(menuId)
        .then(function (source) {
          currentDataSource = source;
        })
    }
  });

  $('#save').on('click', function () {
    // Get new data source name
    var newMenuName = getMenuName();
    var selectedMenuId = getSelectedMenuId();

    if (!selectedMenuId) {
      return;
    }

    var options = {
      id: selectedMenuId,
      name: newMenuName
    };

    // Update data source if name was changed
    if (getSelectedMenuName() !== newMenuName) {
      $("#select-menu option:selected").text(newMenuName).change();

      Fliplet.DataSources.update(options)
        .then(function () {
          setSelectedMenuName(newMenuName);
        });
    }

    // Update Links
    menusPromises[selectedMenuId].forEach(function (linkActionProvider) {
      console.log('Row attached: ', linkActionProvider.row);

      linkActionProvider.then(function (data) {
        console.log('Data to save: ', data);
        linkActionProvider.row.data.action = data.data;


        Fliplet.DataSources.connect(selectedMenuId)
          .then(function (source) {
            return source.update(linkActionProvider.row)
          });
      });

      linkActionProvider.forwardSaveRequest();
    })
  });

  // Helpers
  function addMenu(dataSource) {
    menusPromises[dataSource.id] = [];
    $('#select-menu').append(templates.menuOption(dataSource));
    $('#accordion').append(templates.menu(dataSource));

    $appMenu.append('<option value="' + dataSource.id + '">' + dataSource.name + '</option>');

    Fliplet.DataSources.connect(dataSource.id)
      .then(function (source) {
        return source.find();
      })
      .then(function (rows) {
        if (!rows || !rows.length) {
          return;
        }

        rows = _.sortBy(rows, 'data.order');
        rows.forEach(function (row) {
          addLink(dataSource.id, row);
        });
      });

    $('#menu-' + dataSource.id).sortable({
      handle: ".panel-heading",
      cancel: ".icon-delete",
      start: function(event, ui) {
        $('.panel-collapse.in').collapse('hide');
        ui.item.addClass('focus').css('height', ui.helper.find('.panel-heading').outerHeight() + 2);
        $('.panel').not(ui.item).addClass('faded');
      },
      stop: function(event, ui) {
        ui.item.removeClass('focus');
        $('.panel').not(ui.item).removeClass('faded');

        var sortedIds = $('#menu-' + dataSource.id).sortable("toArray" ,{attribute: 'data-id'}).map(function (value) {
          return Number(value);
        });

        menusPromises[dataSource.id].forEach(function (linkActionProvider) {
          linkActionProvider.row.data.order = sortedIds.indexOf(linkActionProvider.row.id);
        });
      }
    });
  }

  function addLink(dataSourceId, row) {
    if ($.isEmptyObject(row.data)) {
      row.data.action = {
        options: { label: true },
        linkLabel: 'Link label'
      };
    }

    $('#menu-' + dataSourceId).append(templates.menuLink(row));

    var linkProvider = Fliplet.Widget.open('com.fliplet.link', {
      closeOnSave: false,
      selector: '[data-id='+ row.id +']  .link',
      data: row.data.action
    });
    linkProvider.row = row;
    menusPromises[dataSourceId].push(linkProvider);
  }


  // Getters / Setters
  function getSelectedMenuId() {
    return $('#select-menu').val();
  }

  function getSelectedMenuName() {
    return $('#select-menu option:selected').text();
  }

  function setSelectedMenuName(name) {
    return $('#select-menu option:selected').text(name);
  }

  function getMenuName() {
    return $('#menu-name').val();
  }

  function setMenuName(name) {
    return $('#menu-name').val(name);
  }
})();
