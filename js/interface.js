(function () {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu')
  };

  var appId = Fliplet.Env.get('appId');

  var topMenu = Fliplet.App.Settings.get('topMenu') || { id: 'pages', style: 'default' };
  var $appMenu = $('#app-menu');
  var $styleMenu = $('#style-menu');

  var currentDataSource;

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  var menusPromises = {};

  Fliplet.DataSources.get({ type: 'menu', appId: appId, })
    .then(function (dataSources) {
      if (dataSources.length === 0) {
        $("#initial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function (dataSource) {
        addMenu(dataSource);
      });

      $appMenu.val(topMenu.id).change();
      $styleMenu.val(topMenu.style).change();
    });

  // Listeners
  $('.add-menu').on('click', function () {
    var data = {
      appId: appId,
      name: 'Untitled menu',
      type: 'menu'
    };
    Fliplet.DataSources.create(data)
      .then(function (dataSource) {
        addMenu(dataSource);
        $('#select-menu').val(dataSource.id).change();
        $("#panel-holder").show();
        $("#initial-holder").hide();
      })
  });

  $('#add-link').on('click', function () {
    addLink(currentDataSource.id);
  });

  $('#delete-menu').on('click', function () {
    var menuId = getSelectedMenuId();
    Fliplet.DataSources.delete(menuId);
    delete(menusPromises[menuId]);
    $("#select-menu option[value='"+menuId+"']").remove();
    $appMenu.find("option[value='"+menuId+"']").remove();
    $('#select-menu').val(0).change();
    if ($.isEmptyObject(menusPromises)) {
      $('#panel-holder').hide();
      $('#initial-holder').show();
    }

    // Check if the main setting menu is this one and if it is changed it to All links
    if (topMenu.id == menuId) {
      $appMenu.val('pages').change();
      saveSettings();
    }
  });

  $("#accordion")
    .on('click', '.icon-delete', function() {
      var $item = $(this).closest("[data-id], .panel"),
          id = $item.data('id');

      $item.remove();

      for (var i = 0; i < menusPromises[currentDataSource.id].length; i++) {
        if (menusPromises[currentDataSource.id][i].row.id === id) {
          menusPromises[currentDataSource.id].splice(i, 1);
          break;
        }
      }
    })
    .on('keyup change paste', '.link-label', function() {
      $(this).parents('.panel').find('.panel-title-text').html(this.value);
    })
    .on('show.bs.collapse', '.panel-collapse', function() {
      $(this).siblings('.panel-heading').find('.fa-chevron-right').removeClass('fa-chevron-right').addClass('fa-chevron-down');
    })
    .on('hide.bs.collapse', '.panel-collapse', function() {
      $(this).siblings('.panel-heading').find('.fa-chevron-down').removeClass('fa-chevron-down').addClass('fa-chevron-right');
    })
    .on('shown.bs.collapse hidden.bs.collapse', '.panel-collapse', function() {
      $('.tab-content').trigger('scroll');
    });

  $('#select-menu').on('change', function onMenuChange() {
    updateSelectMenuText();

    // Change visible links
    var menuId = $(this).val();

    // Hide all menu panels
    $('#accordion .menu').hide();

    // Show only the selected one
    $('#menu-' + menuId).show();

    // Change menu name on input
    var menuName = getSelectedMenuName();
    setMenuName(menuName);

    // Set current data source
    if (menuId == 0) {
      $('#menu-name-group').hide();
      $('#save').hide();
      $('#menu-links').hide();
      currentDataSource = null;
      $('#add-link').hide();
    } else {
      $('#menu-name-group').show();
      $('#add-link').show();
      $('#save').show();
      $('#menu-links').show();
      Fliplet.DataSources.connect(menuId)
        .then(function (source) {
          currentDataSource = source;
        })
    }
  });

  $('#menu-manager-link').on('click', function() {
    $('.nav-tabs .active').removeClass('active');
    $('#menu-manager-control').addClass('active');
  });

  $appMenu.on('change', function () {
    var selectedText = $(this).find('option:selected').text();
    $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  });

  $styleMenu.on('change', function () {
    var selectedText = $(this).find('option:selected').text();
    $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  });

  Fliplet.Widget.onSaveRequest(function () {
    var tab = $('#menu-manager-control').hasClass('active') ? 'manager' : 'settings';
    switch(tab) {
      case 'manager':
        saveManager();
        break;
      case 'settings':
        saveSettings();
        break;
    }
  });

  function saveSettings() {
    topMenu.id = $appMenu.val();
    topMenu.style = $styleMenu.val();
    topMenu.template = $("#style-" + topMenu.style).html();

    Fliplet.App.Settings.set({ topMenu: topMenu }).then(function () {
      Fliplet.Studio.emit('reload-page-preview');
    });

    showSuccessMessage();
  }

  function saveManager() {
    // Get new data source name
    var newMenuName = getMenuName();

    if (!currentDataSource) {
      return;
    }

    // Update data source if name was changed
    if (getSelectedMenuName() !== newMenuName) {
      $("#select-menu option:selected").text(newMenuName);
      updateSelectMenuText();
      $appMenu.find("option[value='" + currentDataSource.id + "']").text(newMenuName).change();

      var updateOptions = {
        id: currentDataSource.id,
        name: newMenuName
      };

      Fliplet.DataSources.update(updateOptions)
        .then(function () {
          $('#select-menu option:selected').text(newMenuName);
        });
    }

    // Get order of links
    var sortedIds = $('#menu-' + currentDataSource.id).sortable("toArray" ,{attribute: 'data-id'});

    // Update Links
    Promise.all(menusPromises[currentDataSource.id].map(function (provider) {
      // Do stuff in here with result from provider
      return new Promise(function (resolve, reject) {
        provider.then(function (result) {
          provider.row.data.order = sortedIds.indexOf(provider.row.id.toString());
          provider.row.data.linkLabel = $('[data-id="' + provider.row.id + '"]').find('.link-label').val();
          provider.row.data.action = result.data;
          resolve(provider.row.data);
        });
      });
    })).then(function (entries) {
      return Fliplet.DataSources.connect(currentDataSource.id)
        .then(function (source) {
          return source.replaceWith(entries);
        })
    });

    menusPromises[currentDataSource.id].forEach(function (linkActionProvider) {
      linkActionProvider.forwardSaveRequest();
    });

    showSuccessMessage();
  }

  function showSuccessMessage() {
    $('#success-alert').addClass('saved');
    setTimeout(function(){ $('#success-alert').removeClass('saved'); }, 2000);
  }

  // Helpers
  function addMenu(dataSource) {
    menusPromises[dataSource.id] = [];
    $('#select-menu').append(templates.menuOption(dataSource));
    $('#accordion').append(templates.menu(dataSource));

    $appMenu.append(templates.menuOption(dataSource));

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
      }
    });
  }

  function addLink(dataSourceId, row) {
    // Generate a random ID
    var id = 'id-' + Math.random().toString(36).substr(2, 16);

    // Check if it's an existing link or a new one
    row = row || {
        data: {
          action: { },
          linkLabel: 'Menu Link'
        },
        id: id
      };

    $('#menu-' + dataSourceId).append(templates.menuLink(row));

    var linkActionProvider = Fliplet.Widget.open('com.fliplet.link', {
      closeOnSave: false,
      selector: '[data-id='+ row.id +']  .link',
      data: row.data.action
    });

    linkActionProvider.row = row;
    menusPromises[dataSourceId].push(linkActionProvider);
  }

  // Getters / Setters
  function getSelectedMenuId() {
    return $('#select-menu').val();
  }

  function getSelectedMenuName() {
    return $('#select-menu option:selected').text();
  }

  function getMenuName() {
    return $('#menu-name').val();
  }

  function setMenuName(name) {
    return $('#menu-name').val(name);
  }

  function updateSelectMenuText() {
    var selectedText = $('#select-menu').find('option:selected').text();
    $('#select-menu').parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  }
})();
